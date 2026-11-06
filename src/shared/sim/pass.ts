// Slingshot aiming, ball flight and the catch check.
import { DIFFICULTY } from '../data/config';
import { isRunKind, PLAYBOOK } from '../data/playbook';
import { rnd } from './rng';
import { clampChance, takeBall } from './contact';
import { endPlay } from './end';
import { T } from './tuning';
import { A, EV, type SimPlayer, type SimState } from './state';
import { beginRun } from './run';

/** `bad` runs from 0, a pass in a receiver's hands, to 1, a pass far from every receiver (see `passBadness`). */
export function interceptChance(catching: number, distance: number, bad = 0): number {
  const p = T.pass;
  return clampChance(p.pickBase + p.pickPerAttr * catching - p.pickPerDist * distance + p.pickBadPass * bad);
}

/** How bad a pass is: 0 inside a receiver's hands box, rising to 1 at pickBadMiss yards outside every receiver's box. */
export function passBadness(miss: number): number {
  const span = T.pass.pickBadMiss;
  return span > 0 ? Math.min(1, Math.max(0, miss / span)) : 1;
}

/** `miss` is how far, in yards, the drawn ball is outside the receiver's hands box (see `handsMiss`). */
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
  // A designed run has no pass.
  if (isRunKind(PLAYBOOK[s.desc.playbook]?.kind ?? 'pass') && s.mesh && !s.mesh.done) return;
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
  b.peak = passPeak(len, bullet, b.sy, b.ey);
  s.pass = { bullet, target: nearestReceiver(s, ex, ey), piFlag: false, piSpotX: 0, piChecked: false, distance: len, thrownFromX: qb.x, reachI: -1, reachD: 1e9 };
  s.stats[qb.seat].att += 1;
  const fatigue = P.armFatigueHi - ((P.armFatigueHi - P.armFatigueLo) * (qb.sta - 1)) / 9;
  s.armFatigue[qb.seat] += fatigue;
  qb.anim = A.throw;
  s.phase = 'flight';
  s.phaseT = 0;
  s.ev |= EV.throw;
}

/**
 * How far a pass rises above the straight line from hand to hands. Short throws stay flat,
 * and past arcFrom the arc grows faster than the distance, so a deep ball is a clear parabola.
 * Bullets stay low. The height only changes how the throw looks: nothing in the sim reads it.
 */
export function passPeak(len: number, bullet: boolean, sy: number, ey: number): number {
  const P = T.pass;
  if (bullet) return Math.max(P.minPeak, len * P.bulletArcPerYard);
  const peak = len * (P.arcPerYard + P.arcGrowth * Math.max(0, len - P.arcFrom));
  return Math.max(P.minPeak, Math.min(peak, skyRoom(sy, ey)));
}

/** The highest peak that keeps the ball on screen all the way along a throw from sy to ey. */
function skyRoom(sy: number, ey: number): number {
  const P = T.pass;
  const V = T.view;
  const pxPerYard = V.fieldH / T.field.width;
  // How high a ball over the far sideline can be and still be drawn below the top of the screen.
  const above = (V.standsH + V.walkH + V.stripH - P.skyMargin) / pxPerYard;
  let room = Infinity;
  for (let n = 1; n < 20; n++) {
    const k = n / 20;
    const y = sy + (ey - sy) * k;
    const line = P.throwHeight + (P.catchHeight - P.throwHeight) * k;
    room = Math.min(room, (y + above - line) / (4 * k * (1 - k)));
  }
  return room;
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

/**
 * Moves the ball and runs the catch check. The ball is catchable from a little before the aimed spot until it
 * hits the ground a little past it, so a receiver it visibly reaches gets it. Interceptions are only tried at
 * the aimed spot.
 */
export function updateFlight(s: SimState, dt: number): void {
  const b = s.ball;
  const pass = s.pass!;
  const P = T.pass;
  const before = b.t;
  b.t += dt;
  // The ball sits exactly on the aimed spot for one tick, then carries on past it.
  const arriving = before < b.dur && b.t >= b.dur;
  if (arriving) b.t = b.dur;
  const k = b.t / Math.max(0.01, b.dur);
  b.x = b.sx + (b.ex - b.sx) * k;
  b.y = b.sy + (b.ey - b.sy) * k;
  b.z = Math.max(0, b.startZ + (b.endZ - b.startZ) * k + 4 * b.peak * k * (1 - k));
  checkInterference(s);
  const inBounds = ballInBounds(s);
  if (k >= 1 && !inBounds) { incomplete(s); return; }
  if (arriving && contest(s)) return;
  const len = Math.max(0.01, pass.distance);
  // A forced pick waits for the spot, so nobody catches it on the way.
  const open = inBounds && (k >= 1 || s.force !== 'int');
  if (open && k >= Math.max(0.5, 1 - P.catchEarly / len) && b.z <= P.reachZ && tryCatch(s)) return;
  if (k > 1 && (b.z <= 0 || (k - 1) * len >= P.catchLate)) resolvePass(s);
}

function ballInBounds(s: SimState): boolean {
  const b = s.ball;
  return b.y >= 0 && b.y <= T.field.width && b.x >= 0 && b.x <= T.field.len;
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

function canCatch(s: SimState, q: SimPlayer): boolean {
  return q.seat === s.desc.offense && q.role !== 'OL' && q.role !== 'QB' && q.stun <= 0;
}

/** The nearest offensive player who can catch, by ground distance: not a lineman, the QB or someone on the ground. */
function nearestCatcher(s: SimState, x: number, y: number): { p: SimPlayer | null; d: number } {
  let p: SimPlayer | null = null;
  let d = 1e9;
  for (const q of s.players) {
    if (!canCatch(s, q)) continue;
    const dd = Math.hypot(q.x - x, q.y - y);
    if (dd < d) { d = dd; p = q; }
  }
  return { p, d };
}

/**
 * How far, in yards, the ball as drawn on screen is from the receiver's hands box: a box on his figure from his
 * waist (handsLo) to above his head (handsHi), handsHalfW either side of him. 0 means the ball is in his hands.
 * The screen shows a ball at its ground spot raised by its height, so the drawn height above his feet is
 * (his y - ball y) + ball z. This makes what the player sees touching the figure what counts.
 */
export function handsMiss(rc: { x: number; y: number }, x: number, y: number, z: number): number {
  const P = T.pass;
  const dx = Math.max(0, Math.abs(x - rc.x) - P.handsHalfW);
  const h = rc.y - y + z;
  const dy = h < P.handsLo ? P.handsLo - h : h > P.handsHi ? h - P.handsHi : 0;
  return Math.hypot(dx, dy);
}

/** The catcher whose hands box the drawn ball is nearest. */
function nearestHands(s: SimState, x: number, y: number, z: number): { p: SimPlayer | null; d: number } {
  let p: SimPlayer | null = null;
  let d = 1e9;
  for (const q of s.players) {
    if (!canCatch(s, q)) continue;
    const dd = handsMiss(q, x, y, z);
    if (dd < d) { d = dd; p = q; }
  }
  return { p, d };
}

/**
 * At the aimed spot, the nearest defender inside the difficulty's radius gets one try to pick it off, but only
 * if he has beaten every receiver to the ball. A receiver who is nearer shields it, and the defender can only
 * crowd the catch.
 */
function contest(s: SimState): boolean {
  if (s.pass!.piFlag) return false;
  const b = s.ball;
  const nd = nearestDefender(s, b.x, b.y);
  if (!nd.p) return false;
  if (s.force !== 'int') {
    // A bad pass, far from every receiver's hands, hangs there for the defense: they reach further for it and
    // pick it off more often.
    const bad = passBadness(nearestHands(s, b.x, b.y, b.z).d);
    if (nd.d > s.cfg.intRadius + T.pass.pickBadReach * bad) return false;
    if (nearestCatcher(s, b.x, b.y).d < nd.d) return false;
    // A defender who gets there at a full sprint mostly knocks it away.
    const run = Math.min(1, Math.hypot(nd.p.vx, nd.p.vy) / Math.max(1, nd.p.top));
    if (rnd(s) >= interceptChance(nd.p.cat, nd.d, bad) * (1 - T.pass.pickOnTheRun * run)) return false;
  }
  s.force = '';
  intercept(s, nd.p);
  return true;
}

/**
 * Called each tick while the ball is catchable. A receiver whose hands box the drawn ball touches goes for it at
 * once. One it only passes close to reaches for it as it goes by, at his closest point.
 */
function tryCatch(s: SimState): boolean {
  const pass = s.pass!;
  const b = s.ball;
  const near = nearestHands(s, b.x, b.y, b.z);
  if (!near.p) return false;
  if (near.d <= 0) { attemptCatch(s, near.p, 0); return true; }
  if (near.d < pass.reachD) { pass.reachI = near.p.i; pass.reachD = near.d; return false; }
  // Before the aimed spot, a near miss waits if someone is closer to where the ball will arrive, so a
  // bystander's stretch can't take the ball away from the receiver it was thrown to.
  if (b.t < b.dur && nearestHands(s, b.ex, b.ey, b.endZ).d < pass.reachD) return false;
  const rc = s.players[pass.reachI];
  if (rc && rc.stun <= 0 && pass.reachD <= T.pass.stretch && handsMiss(rc, b.x, b.y, b.z) > pass.reachD) {
    attemptCatch(s, rc, pass.reachD);
    return true;
  }
  return false;
}

/**
 * Settles the pass where the ball is now, once it has landed. The receiver nearest it, or the one who came
 * closer while it was catchable, makes a last try if he can stretch to it. Otherwise it falls incomplete.
 */
export function resolvePass(s: SimState): void {
  const pass = s.pass!;
  const b = s.ball;
  let { p: rc, d: miss } = ballInBounds(s) ? nearestHands(s, b.x, b.y, b.z) : { p: null, d: 1e9 };
  const best = s.players[pass.reachI];
  if (best && best.stun <= 0 && pass.reachD < miss) { rc = best; miss = pass.reachD; }
  if (rc && miss <= T.pass.stretch) attemptCatch(s, rc, miss);
  else incomplete(s);
}

function attemptCatch(s: SimState, rc: SimPlayer, miss: number): void {
  const b = s.ball;
  const near = nearestDefender(s, rc.x, rc.y).d <= T.pass.defenderNearRadius;
  if (rnd(s) < catchChance(rc.cat, miss, near, s.cfg.weather, s.pass!.bullet)) {
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
  incomplete(s);
}

function incomplete(s: SimState): void {
  const pass = s.pass!;
  if (pass.piFlag) { endPlay(s, 'pi', pass.piSpotX); return; }
  s.ball.z = 0;
  endPlay(s, 'incomplete', s.desc.los);
}

function touchCost(s: SimState): number {
  return T.run.condPerTouchLo + (T.run.condPerTouchHi - T.run.condPerTouchLo) * rnd(s);
}

function intercept(s: SimState, d: SimPlayer): void {
  d.anim = A.int;
  takeBall(s, d, 'int');
}
