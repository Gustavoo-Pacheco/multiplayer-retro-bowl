// Kicks: two taps (power, then aim), the flight, and the catch that starts a return.
import { DEFENSE_SLOTS, kickRange, KICKER_SLOT, OFFENSE_SLOTS, topSpeed } from '../data/roster';
import { rnd } from './rng';
import { T } from './tuning';
import { requestHandoff } from './contact';
import { endPlay } from './end';
import { beginRun } from './run';
import { moveTo, stopMoving } from './ai/move';
import { emptyBall, makePlayer, baseState } from './setup';
import { A, dirOf, EV, inOwnEndZone, type KickState, type PlayDesc, type Seat, type SimCfg, type SimPlayer, type SimState, type SimTeams } from './state';

const CY = T.field.center;

const receives = (s: SimState): boolean => {
  const t = s.desc.type;
  return t === 'kickoff' || t === 'freeKick' || t === 'onside' || t === 'punt';
};

export function kickSpot(desc: PlayDesc): number {
  const K = T.kick;
  const behind = desc.type === 'punt' ? K.puntBehindLos : desc.type === 'fieldGoal' || desc.type === 'extraPoint' ? K.kickerBehindLos : K.kickoffApproach;
  return Math.max(0.5, Math.min(T.field.len - 0.5, desc.los - desc.dir * behind));
}

/** Where the arrow must point. Goalposts stand at the back of the end zone. */
export function goalPostX(dir: number): number { return dir > 0 ? T.field.len : 0; }

export function createKick(desc: PlayDesc, teams: SimTeams, cfg: SimCfg): SimState {
  const base = baseState(desc, cfg);
  const K = T.kick;
  const dir = desc.dir;
  const off = desc.offense;
  const def = (1 - off) as Seat;
  const rO = teams.rosters[off];
  const rD = teams.rosters[def];
  const cO = teams.cond[off];
  const cD = teams.cond[def];
  const faceO = (dir > 0 ? 1 : -1) as 1 | -1;
  const faceD = (-faceO) as 1 | -1;
  const xAt = (f: number) => Math.max(0.5, Math.min(T.field.len - 0.5, desc.los + dir * f));
  const spread = (n: number, i: number, half: number) => CY + (n <= 1 ? 0 : -half + (2 * half * i) / (n - 1));
  const kicker = rO[KICKER_SLOT];
  const players: SimPlayer[] = [];
  const spot = kickSpot(desc);
  players.push(makePlayer(0, off, kicker, cO[KICKER_SLOT] ?? 1, spot, CY, faceO));
  players[0].job = 'kicker';
  players[0].anim = A.kickStance;
  let returner = -1;

  if (desc.type === 'fieldGoal' || desc.type === 'extraPoint') {
    const holder = makePlayer(1, off, rO[0], cO[0] ?? 1, spot + dir * K.holderAhead, CY + 0.5, faceO);
    holder.job = 'kicker';
    holder.anim = A.hold;
    players.push(holder);
    const line = [5, 6, 7, 4, 2, 3];
    line.forEach((slot, n) => {
      const p = makePlayer(2 + n, off, rO[slot], cO[slot] ?? 1, xAt(-0.6), spread(line.length, n, 4.5), faceO);
      p.job = 'kicker'; p.anim = A.block;
      players.push(p);
    });
    DEFENSE_SLOTS.forEach((slot, n) => {
      const p = makePlayer(8 + n, def, rD[slot], cD[slot] ?? 1, xAt(0.8), spread(DEFENSE_SLOTS.length, n, 6), faceD);
      p.job = 'kickCover'; p.anim = A.rush;
      players.push(p);
    });
  } else {
    // The cover team comes from the defense and the return team from the offense.
    const cover = DEFENSE_SLOTS.filter((sl) => sl !== 10);
    cover.forEach((slot, n) => {
      const p = makePlayer(1 + n, off, rO[slot], cO[slot] ?? 1, xAt(-0.5), spread(cover.length, n, 7.5), faceO);
      p.job = 'kickCover';
      players.push(p);
    });
    // The fastest WR or RB returns automatically.
    let best = -1;
    let bestSpeed = -1;
    OFFENSE_SLOTS.forEach((slot, n) => {
      const r = rD[slot];
      if (r.role !== 'WR' && r.role !== 'RB') return;
      const v = topSpeed(r.attrs.spd, r.role);
      if (v > bestSpeed) { bestSpeed = v; best = n; }
    });
    returner = 8 + best;
    const onside = desc.type === 'onside';
    const punt = desc.type === 'punt';
    const others = OFFENSE_SLOTS.map((_, n) => n).filter((n) => n !== best);
    const deep = punt ? K.puntReturnDepth : onside ? K.onsideReturnDepth : K.returnerDepth;
    const near = punt ? 1 : onside ? K.onsideFrontDepth : K.blockerDepth;
    OFFENSE_SLOTS.forEach((slot, n) => {
      const idx = others.indexOf(n);
      const x = n === best ? xAt(deep) : xAt(near + (idx % 2) * (punt ? 0.4 : K.blockerStagger));
      const y = n === best ? CY : spread(others.length, idx, 7);
      const p = makePlayer(8 + n, def, rD[slot], cD[slot] ?? 1, x, y, faceD);
      p.job = 'return';
      p.ax = p.x; p.ay = p.y;
      players.push(p);
    });
  }
  const accuracy = kicker.attrs.kac;
  const kick: KickState = {
    meter: 0, meterDir: 1, power: 0,
    arrow: 0, arrowDir: 1, aim: 0, arrowHz: Math.max(K.arrowHzMin, K.arrowHzBase + K.arrowHzPerAcc * accuracy),
    range: kickRange(kicker.attrs.rng), distance: 0, landX: 0, landY: 0,
    kicked: false, landed: false, caught: false, good: false, returner, postHit: false,
    onsideRoll: 0, ezWindowT: 0, ezPending: false, ranOut: false, acc: accuracy, auto: false,
  };
  const ball = emptyBall(spot, CY);
  ball.z = 0.2;
  return { ...base, players, ball, kick, phase: 'kickPower' };
}

/** Power from where the meter stopped. Missing green shortens the kick. */
export function kickPower(meter: number): number {
  const K = T.kick;
  if (meter >= K.greenLo && meter <= K.greenHi) return 1;
  const miss = meter < K.greenLo ? K.greenLo - meter : meter - K.greenHi;
  return Math.max(K.minPower, 1 - K.missLoss * miss);
}

export function updateKickMeter(s: SimState, dt: number): void {
  const k = s.kick!;
  const K = T.kick;
  if (s.phase === 'kickPower') {
    k.meter += k.meterDir * dt * K.meterHz * 2;
    if (k.meter >= 1) { k.meter = 2 - k.meter; k.meterDir = -1; }
    if (k.meter <= 0) { k.meter = -k.meter; k.meterDir = 1; }
  } else if (s.phase === 'kickAim') {
    k.arrow += k.arrowDir * dt * k.arrowHz * 4;
    if (k.arrow >= 1) { k.arrow = 2 - k.arrow; k.arrowDir = -1; }
    if (k.arrow <= -1) { k.arrow = -2 - k.arrow; k.arrowDir = 1; }
    if (s.phaseT >= (k.auto ? K.autoAimDelay : K.aimTimeout)) launch(s);
  }
}

/** One tap, from a person or the play clock. */
export function kickTap(s: SimState, auto = false): void {
  const k = s.kick;
  if (!k) return;
  if (s.phase === 'kickPower') {
    k.power = kickPower(k.meter);
    k.auto = auto;
    s.phase = 'kickAim';
    s.phaseT = 0;
    s.players[0].anim = A.kickApproach;
    s.ev |= EV.snap;
  } else if (s.phase === 'kickAim') {
    launch(s);
  } else if (s.phase === 'kickFlight') {
    k.ranOut = true; // tapping before the returner stops runs it out
  }
}

function launch(s: SimState): void {
  const k = s.kick!;
  const K = T.kick;
  const t = s.desc.type;
  const dir = s.desc.dir;
  const b = s.ball;
  const x0 = s.players[0].x;
  let deg = k.arrow * K.arrowMaxDeg;
  if (s.cfg.weather === 'wind') deg += (rnd(s) * 2 - 1) * K.windDeg;
  k.aim = deg;
  const tan = Math.tan((deg * Math.PI) / 180);
  if (t === 'fieldGoal' || t === 'extraPoint') {
    const target = goalPostX(dir);
    const need = Math.abs(target - x0);
    const reach = (t === 'extraPoint' ? Math.max(k.range, K.xpMinRange) : k.range) * k.power;
    const dist = Math.min(reach, need);
    const side = need * tan;
    const inside = Math.abs(side) <= K.uprightHalf;
    k.postHit = reach >= need && Math.abs(Math.abs(side) - K.uprightHalf) <= K.postHitBand;
    // Off the post: a coin flip whether it bounces through.
    k.good = reach >= need && (k.postHit ? rnd(s) < K.postLuck : inside);
    k.distance = dist;
    k.landX = x0 + dir * dist;
    k.landY = CY + dist * tan;
  } else if (t === 'onside') {
    k.distance = K.onsideDistance * (K.onsidePowerBase + (1 - K.onsidePowerBase) * k.power);
    k.landX = x0 + dir * k.distance;
    k.landY = CY + k.distance * tan;
    k.onsideRoll = rnd(s);
  } else {
    const punt = t === 'punt';
    k.distance = (k.range + (punt ? K.puntBonus : K.kickoffBonus)) * k.power;
    k.landX = x0 + dir * k.distance;
    k.landY = CY + k.distance * tan * (punt ? K.puntAimFactor : K.kickoffAimFactor);
  }
  b.holder = -1;
  b.sx = x0; b.sy = CY; b.ex = k.landX; b.ey = k.landY; b.t = 0;
  b.dur = t === 'onside' ? K.onsideHang : Math.max(K.minHang, K.hangPerYard * k.distance);
  b.peak = t === 'onside' ? K.onsidePeak : K.peakPerYard * k.distance;
  b.startZ = 0.2;
  b.endZ = t === 'fieldGoal' || t === 'extraPoint' ? K.crossbarZ : 0.4;
  k.kicked = true;
  s.phase = 'kickFlight';
  s.phaseT = 0;
  s.players[0].anim = t === 'punt' ? A.punt : t === 'onside' ? A.onside : A.kick;
  s.ev |= EV.kick;
  if (!receives(s)) return;
  const other = (1 - s.desc.offense) as Seat;
  s.possessor = other;
  // Control passes as soon as the ball is kicked. The flight hides the switch, so nothing freezes.
  if (s.cfg.liveReturns) {
    const spot = Math.max(0, Math.min(T.field.len, k.landX));
    requestHandoff(s, other, 'kick', false, spot);
  }
}

/** A kick that left the field or came down in the receiver's end zone. */
function kickDead(s: SimState, x: number): void {
  const other = (1 - s.desc.offense) as Seat;
  const dirR = dirOf(s, other);
  s.possessor = other;
  s.lastCarrier = other;
  if (x <= 0 || x >= T.field.len || inOwnEndZone(x, dirR)) endPlay(s, 'touchback', x);
  else endPlay(s, 'kickOut', x);
}

function landed(s: SimState): void {
  const k = s.kick!;
  const b = s.ball;
  const t = s.desc.type;
  if (t === 'fieldGoal' || t === 'extraPoint') {
    if (k.postHit) s.ev |= EV.post;
    const spot = s.players[0].x;
    if (t === 'fieldGoal') endPlay(s, k.good ? 'fgGood' : 'fgMiss', spot);
    else endPlay(s, k.good ? 'xpGood' : 'xpMiss', spot);
    return;
  }
  const out = k.landY < 0 || k.landY > T.field.width || k.landX <= 0 || k.landX >= T.field.len;
  if (out) { kickDead(s, Math.max(0, Math.min(T.field.len, k.landX))); return; }
  if (t === 'onside') {
    // Everyone goes for it. Kicker accuracy decides who comes up with it.
    const chance = Math.max(T.chance.min, Math.min(T.chance.max, T.kick.onsideBase + T.kick.onsidePerAcc * k.acc));
    s.forceRecover = (k.onsideRoll < chance ? s.desc.offense : ((1 - s.desc.offense) as Seat));
    b.vx = s.desc.dir * T.kick.onsideRoll; b.vy = 0; b.bounce = 0.4;
    s.phase = 'loose';
    s.phaseT = 0;
    for (const p of s.players) if (p.job !== 'kicker' || p.i !== 0) p.job = 'chase';
    return;
  }
  if (!s.cfg.liveReturns) {
    if (t === 'punt') { kickDead(s, k.landX); return; }
    const other = (1 - s.desc.offense) as Seat;
    s.lastCarrier = other;
    endPlay(s, 'touchback', k.landX);
    return;
  }
  k.landed = true;
  b.vx = s.desc.dir * (T.kick.bounceDist / T.kick.bounceTime);
  b.vy = 0;
  b.bounce = T.kick.bounceTime;
}

function catchKick(s: SimState, r: SimPlayer): void {
  const k = s.kick!;
  const b = s.ball;
  k.caught = true;
  b.holder = r.i;
  b.x = r.x; b.y = r.y; b.z = 1;
  s.possessor = r.seat;
  s.lastCarrier = r.seat;
  s.catchX = r.x;
  s.clockRun = true;
  s.ev |= EV.catch;
  const dir = dirOf(s, r.seat);
  s.ezImpetus = inOwnEndZone(r.x, dir);
  beginRun(s);
  if (s.ezImpetus) {
    s.ezWait = k.ranOut ? 0 : T.kick.ezWindow;
    s.ezRanOut = k.ranOut;
  }
}

export function updateKickFlight(s: SimState, dt: number): void {
  const k = s.kick!;
  const b = s.ball;
  if (!k.landed) {
    b.t += dt;
    const u = Math.min(1, b.t / b.dur);
    b.x = b.sx + (b.ex - b.sx) * u;
    b.y = b.sy + (b.ey - b.sy) * u;
    b.z = b.startZ + (b.endZ - b.startZ) * u + 4 * b.peak * u * (1 - u);
    if (u >= 1) landed(s);
    if (s.phase === 'kickFlight' && s.cfg.liveReturns && k.returner >= 0 && u >= T.kick.catchFrom) {
      const r = s.players[k.returner];
      if (Math.hypot(r.x - b.x, r.y - b.y) <= T.kick.catchRadius) catchKick(s, r);
    }
    return;
  }
  // On the ground and rolling: the returner goes to pick it up.
  b.bounce = Math.max(0, b.bounce - dt);
  const f = Math.exp(-T.fumble.friction * dt);
  b.vx *= f;
  b.x += b.vx * dt;
  b.z = b.bounce > 0 ? Math.abs(Math.sin(s.phaseT * 9)) * b.bounce : 0.2;
  if (b.x <= 0 || b.x >= T.field.len) { kickDead(s, Math.max(0, Math.min(T.field.len, b.x))); return; }
  const r = s.players[k.returner];
  if (Math.hypot(r.x - b.x, r.y - b.y) <= T.kick.catchRadius) catchKick(s, r);
}

/** Everyone but the ball carrier before and during a kick. */
export function updateKickPlayer(s: SimState, p: SimPlayer, dt: number): void {
  const k = s.kick;
  if (!k || !k.kicked || p.job === 'kicker') {
    stopMoving(p, dt);
    if (p.i === 0 && k?.kicked && s.phaseT > 0.4) p.anim = A.stance;
    return;
  }
  const b = s.ball;
  if (p.job === 'kickCover') {
    if (s.desc.type === 'fieldGoal' || s.desc.type === 'extraPoint') { moveTo(p, s.players[0].x, p.y, p.top * T.kick.fgRushSpeed, dt); p.anim = A.rush; return; }
    if (s.phaseT < T.kick.coverDelay) { stopMoving(p, dt); return; }
    moveTo(p, k.landX, p.y + (k.landY - p.y) * 0.5, p.top, dt);
    p.anim = A.run;
    p.face = p.vx >= 0 ? 1 : -1;
    return;
  }
  if (p.i === k.returner) {
    const tx = k.landed ? b.x : k.landX;
    const ty = k.landed ? b.y : Math.max(0.4, Math.min(T.field.width - 0.4, k.landY));
    if (Math.hypot(p.x - tx, p.y - ty) > 0.25) { moveTo(p, tx, ty, p.top * T.kick.returnerSpeedAssist, dt); p.anim = A.run; }
    else { stopMoving(p, dt); p.anim = A.stance; }
    p.face = (s.desc.dir > 0 ? -1 : 1) as 1 | -1;
    return;
  }
  // Return blockers drop back toward the returner.
  const r = k.returner >= 0 ? s.players[k.returner] : null;
  if (r) moveTo(p, r.x + s.desc.dir * -T.kick.blockerScreen, p.ay + (r.y - p.ay) * 0.3, p.top * 0.8, dt);
  else stopMoving(p, dt);
  p.anim = A.run;
}
