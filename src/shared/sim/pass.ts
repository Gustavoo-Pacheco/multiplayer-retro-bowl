// Slingshot aiming, ball flight and the catch check.
import { DIFFICULTY } from '../data/config';
import { rnd } from './rng';
import { clampChance, takeBall } from './contact';
import { endPlay } from './end';
import { T } from './tuning';
import { A, EV, type SimPlayer, type SimState } from './state';
import { beginRun } from './run';

export function interceptChance(catching: number, distance: number): number {
  const p = T.pass;
  return clampChance(p.pickBase + p.pickPerAttr * catching - p.pickPerDist * distance);
}

export function catchChance(catching: number, miss: number, defenderNear: boolean, weather: string, bullet: boolean): number {
  const p = T.pass;
  return clampChance(
    p.catchBase + p.catchPerAttr * catching - p.catchPerMiss * miss
    - (defenderNear ? p.catchDefenderNear : 0)
    - (p.weatherPenalty[weather] ?? 0)
    - (bullet ? p.catchBullet : 0));
}

export function maxAimErrorDeg(accuracy: number, fatigue: number): number {
  return (10 - accuracy) * T.pass.errorPerAccuracyDeg + fatigue * T.pass.fatigueErrorDeg;
}

export function aimFadeAlpha(s: SimState, full: boolean): number {
  if (full) return 1;
  const strength = DIFFICULTY[s.cfg.difficulty].aimFade;
  const accuracyLoss = (10 - s.qbAcc) / 9;
  return 1 - strength * (0.25 + 0.75 * accuracyLoss);
}

export function startAim(s: SimState): void {
  if (s.phase !== 'pocket' || s.aim.on || s.ball.holder !== 0) return;
  s.aim.on = true;
  s.aim.heldFrom = s.t;
  s.aim.dx = 0;
  s.aim.dy = 0;
  s.aim.bullet = false;
}

/** Releases the slingshot. Too short a hold or a release in the dead zone cancels. */
export function release(s: SimState): void {
  if (!s.aim.on) return;
  s.aim.on = false;
  const held = s.t - s.aim.heldFrom;
  const len = Math.hypot(s.aim.dx, s.aim.dy);
  if (held < T.pocket.aimMinHold || len < T.pocket.aimDeadZone) return;
  launch(s, s.aim.dx, s.aim.dy, s.aim.bullet && s.cfg.bullet);
}

export function launch(s: SimState, dx: number, dy: number, bullet: boolean): void {
  const qb = s.players[0];
  const P = T.pass;
  let len = Math.hypot(dx, dy) || 1;
  const range = s.armRange;
  if (len > range) { dx *= range / len; dy *= range / len; len = range; }
  const maxErr = maxAimErrorDeg(s.qbAcc, s.qbArmFatigue) * (Math.PI / 180);
  let err = (rnd(s) * 2 - 1) * maxErr;
  if (s.cfg.weather === 'wind') err += (rnd(s) * 2 - 1) * P.windDriftDeg * (Math.PI / 180);
  const c = Math.cos(err);
  const n = Math.sin(err);
  const ex = qb.x + dx * c - dy * n;
  const ey = qb.y + dx * n + dy * c;
  const speed = P.speed * (bullet ? P.bulletMult : 1);
  const b = s.ball;
  b.holder = -1;
  b.sx = qb.x; b.sy = qb.y; b.ex = ex; b.ey = ey; b.t = 0; b.dur = len / speed;
  b.startZ = P.throwHeight; b.endZ = P.catchHeight;
  b.peak = Math.max(P.minPeak, len * (bullet ? P.bulletArcPerYard : P.arcPerYard));
  s.pass = { bullet, target: nearestReceiver(s, ex, ey), piFlag: false, piSpotX: 0, piChecked: false, distance: len, thrownFromX: qb.x };
  s.stats[qb.seat].att += 1;
  const fatigue = P.armFatigueHi - ((P.armFatigueHi - P.armFatigueLo) * (qb.sta - 1)) / 9;
  s.armFatigue[qb.seat] += fatigue;
  qb.anim = A.throw;
  s.phase = 'flight';
  s.phaseT = 0;
  s.ev |= EV.throw;
}

function nearestReceiver(s: SimState, x: number, y: number): number {
  let best = -1;
  let bd = 1e9;
  for (const p of s.players) {
    if (p.seat !== s.desc.offense || p.role === 'OL' || p.role === 'QB') continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = p.i; }
  }
  return best;
}

export function updateFlight(s: SimState, dt: number): void {
  const b = s.ball;
  b.t += dt;
  const k = Math.min(1, b.t / Math.max(0.01, b.dur));
  b.x = b.sx + (b.ex - b.sx) * k;
  b.y = b.sy + (b.ey - b.sy) * k;
  b.z = b.startZ + (b.endZ - b.startZ) * k + 4 * b.peak * k * (1 - k);
  checkInterference(s);
  if (k >= 1) resolvePass(s);
}

function checkInterference(s: SimState): void {
  const pass = s.pass!;
  if (pass.piChecked || !s.cfg.penalties) return;
  if (s.ball.dur - s.ball.t > T.pass.piWindow) return;
  pass.piChecked = true;
  const rc = s.players[pass.target];
  if (!rc) return;
  for (const d of s.players) {
    if (d.seat === rc.seat) continue;
    if (Math.hypot(d.x - rc.x, d.y - rc.y) <= T.pass.piRadius && rnd(s) < T.pass.piChance) {
      pass.piFlag = true;
      pass.piSpotX = rc.x;
      return;
    }
  }
}

function nearestDefender(s: SimState, x: number, y: number): { p: SimPlayer | null; d: number } {
  let p: SimPlayer | null = null;
  let d = 1e9;
  for (const q of s.players) {
    if (q.seat === s.desc.offense || q.stun > 0) continue;
    const dd = Math.hypot(q.x - x, q.y - y);
    if (dd < d) { d = dd; p = q; }
  }
  return { p, d };
}

export function resolvePass(s: SimState): void {
  const b = s.ball;
  const pass = s.pass!;
  const inBounds = b.y >= 0 && b.y <= T.field.width && b.x >= 0 && b.x <= T.field.len;
  // Interception is rolled first, for the nearest defender inside the difficulty's radius.
  if (inBounds && !pass.piFlag) {
    const nd = nearestDefender(s, b.x, b.y);
    if (nd.p && (nd.d <= s.cfg.intRadius || s.force === 'int')) {
      if (s.force === 'int' || rnd(s) < interceptChance(nd.p.cat, nd.d)) {
        s.force = '';
        intercept(s, nd.p);
        return;
      }
    }
  }
  // Catch check for the nearest receiver within 2.5 yards.
  let rc: SimPlayer | null = null;
  let miss = 1e9;
  if (inBounds) {
    for (const p of s.players) {
      if (p.seat !== s.desc.offense || p.role === 'OL' || p.role === 'QB' || p.stun > 0) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < miss) { miss = d; rc = p; }
    }
  }
  if (rc && miss <= T.pass.catchRadius) {
    const near = nearestDefender(s, rc.x, rc.y).d <= T.pass.defenderNearRadius;
    if (rnd(s) < catchChance(rc.cat, miss, near, s.cfg.weather, pass.bullet)) {
      rc.anim = A.catch;
      s.ev |= EV.catch;
      s.catchX = rc.x;
      s.stats[rc.seat].comp += 1;
      s.touches.push([rc.seat, rc.slot, -touchCost(s)]);
      b.holder = rc.i;
      b.x = rc.x; b.y = rc.y;
      s.lastCarrier = rc.seat;
      beginRun(s);
      return;
    }
    rc.anim = A.drop;
    s.ev |= EV.drop;
  }
  if (pass.piFlag) { endPlay(s, 'pi', pass.piSpotX); return; }
  b.z = 0;
  endPlay(s, 'incomplete', s.desc.los);
}

function touchCost(s: SimState): number {
  return T.run.condPerTouchLo + (T.run.condPerTouchHi - T.run.condPerTouchLo) * rnd(s);
}

function intercept(s: SimState, d: SimPlayer): void {
  d.anim = A.int;
  takeBall(s, d, 'int');
}
