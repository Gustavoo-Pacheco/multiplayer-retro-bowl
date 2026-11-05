// Tackles, fumbles and the loose ball. The formulas are exported, so tests can check them directly.
import { rnd, rndRange } from './rng';
import { T } from './tuning';
import { A, dirOf, EV, inOppEndZone, inOwnEndZone, type Seat, type SimPlayer, type SimState } from './state';
import { endPlay } from './end';
import { addTouch, beginRun } from './run';
import { moveTo, stopMoving } from './ai/move';

export function clampChance(p: number): number { return Math.max(T.chance.min, Math.min(T.chance.max, p)); }

export type HitAngle = 'behind' | 'front' | 'side';

export function tackleChance(tackling: number, strength: number, from: HitAngle, stiff: boolean, truck: boolean): number {
  const c = T.contact;
  let p = c.tackleBase + c.tacklePerAttr * (tackling - strength);
  if (from === 'behind') p += c.behind;
  if (from === 'front') p += c.headOn;
  if (stiff) p += c.stiff;
  if (truck && from === 'front') p += c.truckFront;
  if (truck && from === 'behind') p += c.truckBehind;
  return clampChance(p);
}

export function fumbleChance(catching: number, lowCondition: boolean, wet: boolean, diving: boolean, mult = 1): number {
  const c = T.contact;
  if (mult === 0) return 0;
  const p = (c.fumbleBase + c.fumblePerAttr * (10 - catching) + (lowCondition ? c.fumbleLowCond : 0) + (wet ? c.fumbleWet : 0) + (diving ? c.fumbleDive : 0)) * mult;
  return clampChance(p);
}

export function hitAngle(r: SimPlayer, d: SimPlayer, dirSign: number): HitAngle {
  const sp = Math.hypot(r.vx, r.vy);
  const ux = sp > 0.5 ? r.vx / sp : dirSign;
  const uy = sp > 0.5 ? r.vy / sp : 0;
  const dx = d.x - r.x;
  const dy = d.y - r.y;
  const n = Math.hypot(dx, dy) || 1;
  const dot = (dx * ux + dy * uy) / n;
  if (dot > 0.5) return 'front';
  if (dot < -0.5) return 'behind';
  return 'side';
}

/** Checks defenders against the ball holder. Returns true if a tackle ended the play or the ball came loose. */
export function checkContact(s: SimState, dt: number): boolean {
  const hIdx = s.ball.holder;
  if (hIdx < 0) return false;
  const r = s.players[hIdx];
  const dirSign = dirOf(s, r.seat);
  const diving = s.g.diveT > 0;
  for (const d of s.players) {
    if (d.tackleCd > 0) d.tackleCd -= dt;
    if (d.seat === r.seat || d.stun > 0 || d.engaged >= 0 || d.tackleCd > 0) continue;
    const dist = Math.hypot(d.x - r.x, d.y - r.y);
    if (dist > T.contact.radius) continue;
    const from = hitAngle(r, d, dirSign);
    const stiff = s.g.stiffT > 0;
    const truck = s.g.truck && s.cfg.trucking;
    const p = tackleChance(d.tck, r.str, from, stiff, truck);
    s.ev |= EV.grunt;
    if (rnd(s) < p) {
      addTouch(s, r);
      s.ev |= EV.tackle;
      const fChance = fumbleChance(r.cat, r.cond < 0.5, s.cfg.weather === 'rain' || s.cfg.weather === 'snow', diving, s.cfg.fumbleMult);
      if (s.force === 'fumble' || rnd(s) < fChance) { fumble(s, r, d); return true; }
      const n = dist || 1;
      const ux = (r.x - d.x) / n;
      const fall = from === 'behind' ? T.contact.fallForward * dirSign : ux * T.contact.knockback;
      // Backward contact: the spot is wherever the runner ends up.
      r.x = Math.max(0, Math.min(T.field.len, r.x + fall));
      d.anim = A.tackle;
      d.vx = d.vy = 0;
      d.stun = 9;
      const wasPocket = s.phase === 'pocket';
      r.anim = wasPocket ? A.sacked : A.tackled;
      if (wasPocket) d.anim = A.sack;
      if (s.cfg.injuries && rnd(s) < T.run.injuryChance * (r.cond < 0.5 ? 2 : 1)) s.injury = [r.seat, r.slot];
      if (inOppEndZone(r.x, dirSign)) endPlay(s, 'td');
      else endPlay(s, 'tackle');
      return true;
    }
    d.stun = T.contact.missStun;
    d.tackleCd = T.contact.retryCd;
    d.anim = A.tackle;
    s.g.hitSlowT = T.contact.hitSlowTime;
  }
  return false;
}

/** The ball comes loose. A debug force bounces it to the nearest opponent. */
export function fumble(s: SimState, r: SimPlayer, hitter: SimPlayer | null): void {
  const F = T.fumble;
  const b = s.ball;
  s.lastCarrier = r.seat;
  b.holder = -1;
  b.x = r.x; b.y = r.y;
  const speed = rndRange(s, F.speedLo, F.speedHi);
  const ang = rnd(s) * Math.PI * 2;
  b.vx = Math.cos(ang) * speed;
  b.vy = Math.sin(ang) * speed * 0.6;
  b.bounce = rndRange(s, F.bounceLo, F.bounceHi);
  if (s.force === 'fumble') {
    let near: SimPlayer | null = null;
    let nd = 1e9;
    for (const q of s.players) {
      if (q.seat === r.seat) continue;
      const dd = Math.hypot(q.x - r.x, q.y - r.y);
      if (dd < nd) { nd = dd; near = q; }
    }
    s.forceRecover = (1 - r.seat) as Seat;
    if (near) { const t = Math.max(0.2, nd / 4); b.vx = (near.x - r.x) / t; b.vy = (near.y - r.y) / t; b.bounce = t; }
    s.force = '';
  }
  r.anim = A.fumble;
  r.stun = 0.7;
  r.vx *= 0.3; r.vy *= 0.3;
  if (hitter) { hitter.stun = 0.5; hitter.anim = A.tackle; }
  s.phase = 'loose';
  s.phaseT = 0;
  s.ev |= EV.fumble;
  for (const p of s.players) if (p.engaged >= 0) { p.engaged = -1; }
  for (const p of s.players) p.job = 'chase';
}

export function updateLoose(s: SimState, dt: number): void {
  const F = T.fumble;
  const b = s.ball;
  b.bounce -= dt;
  const k = Math.exp(-F.friction * dt);
  b.vx *= k; b.vy *= k;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z = b.bounce > 0 ? Math.abs(Math.sin(s.phaseT * 9)) * Math.max(0.1, b.bounce) * F.popZ * 0.5 : 0.2;
  const inEz = b.x <= T.field.ez || b.x >= T.field.len - T.field.ez;
  if (b.x < 0 || b.x > T.field.len || ((b.y < 0 || b.y > T.field.width) && inEz)) {
    b.x = Math.max(0, Math.min(T.field.len, b.x));
    endPlay(s, 'fumbleOutEndZone', b.x);
    return;
  }
  if (b.y < 0 || b.y > T.field.width) {
    b.y = Math.max(0, Math.min(T.field.width, b.y));
    endPlay(s, 'oob', b.x);
    return;
  }
  if (s.phaseT < F.recoverMinTime) return;
  let best: SimPlayer | null = null;
  let bd = 1e9;
  for (const p of s.players) {
    if (p.stun > 0) continue;
    if (s.forceRecover >= 0 && p.seat !== s.forceRecover) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best && bd <= F.recoverRadius && (s.forceRecover >= 0 || rnd(s) < F.recoverChance)) takeBall(s, best, 'fumble');
  else if (best && s.phaseT > 7) takeBall(s, best, 'fumble'); // a safety net, so a play can't stall
}

/** A player gains the ball from the air or the ground. */
export function takeBall(s: SimState, p: SimPlayer, reason: 'int' | 'fumble'): void {
  const b = s.ball;
  const turnover = p.seat !== s.possessor;
  const prevSeat = s.possessor;
  b.holder = p.i;
  b.x = p.x; b.y = p.y; b.z = 1;
  s.possessor = p.seat;
  s.lastCarrier = p.seat;
  s.forceRecover = -1;
  if (turnover) {
    if (reason === 'int') { s.stats[prevSeat].int += 1; s.ev |= EV.int; }
    else s.stats[prevSeat].fumLost += 1;
  }
  const dir = dirOf(s, p.seat);
  if (s.desc.type === 'twoPoint' && turnover) { endPlay(s, 'tryFailed'); return; }
  if (inOppEndZone(p.x, dir)) { endPlay(s, 'td'); return; }
  s.ezImpetus = turnover && inOwnEndZone(p.x, dir);
  beginRun(s);
  if (s.ezImpetus) { s.ezWait = T.kick.ezWindow; s.ezRanOut = false; }
  if (p.seat === s.control) s.autoRun = false;
  else if (turnover) requestHandoff(s, p.seat, reason);
}

export function requestHandoff(s: SimState, to: Seat, reason: 'int' | 'fumble' | 'kick' | 'onside'): void {
  const holder = s.ball.holder >= 0 ? s.players[s.ball.holder] : null;
  s.handoff = { to, reason, spotX: holder ? holder.x : s.ball.x };
  s.frozen = true;
}

/** The server said the other player takes over. Run on the new controller's copy. */
export function acceptHandoff(s: SimState): void {
  if (s.handoff) s.control = s.handoff.to;
  s.handoff = null;
  s.frozen = false;
  s.autoRun = false;
  s.g.lastGestureAt = s.t;
}

/** The server said the other player can't take over: finish with the auto-runner. */
export function continueWithAutoRunner(s: SimState): void {
  s.handoff = null;
  s.frozen = false;
  s.autoRun = true;
}

/** Everyone runs to a loose ball. */
export function updateChaser(s: SimState, p: SimPlayer, dt: number): void {
  if (p.stun > 0) { stopMoving(p, dt); return; }
  moveTo(p, s.ball.x, s.ball.y, p.top, dt);
  p.anim = A.run;
  p.face = p.vx >= 0 ? 1 : -1;
}
