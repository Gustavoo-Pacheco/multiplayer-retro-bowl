import { T } from '../tuning';
import { PLAYBOOK } from '../../data/playbook';
import { A, type SimPlayer, type SimState } from '../state';
import { holdEdge, moveTo } from './move';
import { chaseSpeed } from './pursuit';
import { updateRush } from './rush';

/** Breaks on a thrown ball near this defender. Returns true if it did. */
function breakOnBall(s: SimState, p: SimPlayer, dt: number, reach: number): boolean {
  const ball = s.ball;
  if (s.phase !== 'flight' || s.phaseT <= T.ai.ballReactDelay + s.cfg.coverLag) return false;
  if (Math.hypot(ball.ex - p.x, ball.ey - p.y) >= reach) return false;
  moveTo(p, ball.ex, ball.ey, p.top, dt);
  p.anim = A.run;
  p.face = p.vx >= 0 ? 1 : -1;
  return true;
}

function coverAnim(s: SimState, p: SimPlayer): void {
  const dir = s.desc.dir;
  const back = p.vx * dir;
  p.anim = back > 0.5 ? A.backpedal : Math.hypot(p.vx, p.vy) > 0.5 ? A.run : A.stance;
  p.face = back > 0.5 || Math.hypot(p.vx, p.vy) < 0.5 ? ((-dir) as 1 | -1) : (p.vx >= 0 ? 1 : -1);
}

/** Whether a man defender's receiver is out on a pattern, rather than blocking or still in the backfield. */
const released = (q: SimPlayer): boolean => q.job === 'route' || q.job === 'carry';

/** Each DB or LB trails an assigned receiver, with lag from the difficulty table. */
export function updateCover(s: SimState, p: SimPlayer, dt: number): void {
  const dir = s.desc.dir;
  if (breakOnBall(s, p, dt, T.ai.ballReact)) return;
  const rc = s.players[p.target];
  // His man stayed in to block: sit at the alignment and mirror the QB, ready for a late release.
  if (!rc || !released(rc)) {
    const qb = s.players[0];
    moveTo(p, p.ax, p.ay + (qb.y - T.field.center) * 0.3, p.top * T.ai.ratSpeed, dt);
    coverAnim(s, p);
    return;
  }
  const lag = s.cfg.coverLag;
  const short = s.desc.toGo <= 3;
  const cushion = short ? T.ai.coverCushionShort : T.ai.coverCushion;
  let tx = rc.x - rc.vx * lag + dir * cushion;
  // Kept as far in from a sideline as the routes, so trailing his man never puts him over the bench.
  const room = T.field.routeRoom;
  const ty = Math.max(room, Math.min(T.field.width - room, rc.y - rc.vy * lag));
  const speed = chaseSpeed(p.top * T.ai.coverSpeed, rc.top, T.ai.coverFloor, T.ai.coverCeiling);
  const gap = (p.x - rc.x) * dir;
  // Stay downfield of a receiver who is still coming: hold the spot and let the route arrive.
  const coming = rc.vx * dir > 1;
  if (coming && (p.x - tx) * dir > 0) tx = p.x;
  const y0 = p.y;
  moveTo(p, tx, ty, speed, dt);
  holdEdge(p, y0);
  p.anim = gap > T.ai.backpedalUntil * 0.4 && p.vx * dir > 0.5 ? A.backpedal : Math.hypot(p.vx, p.vy) > 0.5 ? A.run : A.stance;
  p.face = gap > 0.5 ? ((-dir) as 1 | -1) : (p.vx >= 0 ? 1 : -1);
}

/** The deep safety shades the deepest receiver. */
export function updateDeep(s: SimState, p: SimPlayer, dt: number): void {
  const dir = s.desc.dir;
  let deep: SimPlayer | null = null;
  let best = -1e9;
  for (const q of s.players) {
    if (q.seat !== s.desc.offense || q.job !== 'route') continue;
    const f = q.x * dir;
    if (f > best) { best = f; deep = q; }
  }
  if (breakOnBall(s, p, dt, T.ai.ballReact * 1.3)) return;
  const tx = deep ? deep.x + dir * 4 : p.x;
  const ty = deep ? T.field.center + (deep.y - T.field.center) * 0.65 : T.field.center;
  moveTo(p, Math.max(p.x * dir, tx * dir) * dir, ty, p.top * 0.9, dt);
  p.anim = Math.hypot(p.vx, p.vy) > 0.5 ? A.backpedal : A.stance;
  p.face = (-dir) as 1 | -1;
}

/**
 * Zone coverage: guard an area, not a man. A deep zone stays over the top of the deepest receiver in it;
 * an underneath zone sits in the throwing lane of the nearest one. Empty zones drop to their landmark
 * and lean toward where the QB is aiming.
 */
export function updateZone(s: SimState, p: SimPlayer, dt: number): void {
  const z = p.zone;
  const dir = s.desc.dir;
  if (!z) { moveTo(p, p.ax, p.ay, p.top * 0.7, dt); coverAnim(s, p); return; }
  if (breakOnBall(s, p, dt, T.ai.ballReact * (z.deep ? 1.3 : 1))) return;
  const los = s.desc.los;
  const depthOf = (x: number) => (x - los) * dir;
  const ahead = T.ai.zoneLook - s.cfg.coverLag;
  let threat: SimPlayer | null = null;
  let fx = 0;
  let fy = 0;
  let best = -1e9;
  for (const q of s.players) {
    if (q.seat !== s.desc.offense || q.job !== 'route') continue;
    const qx = q.x + q.vx * ahead;
    const qy = q.y + q.vy * ahead;
    const d = depthOf(qx);
    if (Math.abs(qy - z.y) > z.hw + T.ai.zoneSlack || d < z.d0 - 1 || d > z.d1 + 1) continue;
    const score = z.deep ? d : -Math.hypot(qx - z.x, qy - z.y);
    if (score > best) { best = score; threat = q; fx = qx; fy = qy; }
  }
  const yLo = z.y - z.hw - 1;
  const yHi = z.y + z.hw + 1;
  let tx: number;
  let ty: number;
  let speed: number;
  if (threat) {
    const d = depthOf(fx);
    const want = z.deep ? Math.max(d + T.ai.zoneCushion, z.d0) : Math.max(z.d0, Math.min(z.d1, d - T.ai.zoneUnder));
    tx = los + dir * want;
    // Inside the receiver, between him and the QB, so a good throw beats the zone and a bad one is his.
    const inside = fy > T.field.center ? -1 : 1;
    ty = Math.max(yLo, Math.min(yHi, fy + inside * (z.deep ? T.ai.zoneInsideDeep : T.ai.zoneInside)));
    speed = chaseSpeed(p.top * T.ai.coverSpeed, threat.top, T.ai.coverFloor, T.ai.coverCeiling);
  } else {
    tx = z.x;
    ty = z.y;
    if (s.aim.on) {
      const qb = s.players[0];
      ty += Math.max(-T.ai.zoneShade, Math.min(T.ai.zoneShade, (qb.y + s.aim.dy - z.y) * 0.5));
    }
    speed = p.top * T.ai.zoneSpeed;
  }
  moveTo(p, tx, ty, speed, dt);
  coverAnim(s, p);
}

/** Run Stuff: the linebacker attacks the back. If the back runs a route, it's tight man coverage on him; if he blocks, it's a blitz. */
export function updateCrash(s: SimState, p: SimPlayer, dt: number): void {
  const rb = s.players[1];
  if (p.engaged < 0 && (rb.job === 'mesh' || rb.job === 'fake')) {
    moveTo(p, rb.x + rb.vx * 0.2, rb.y + rb.vy * 0.2, p.top * T.ai.crashSpeed, dt);
    p.anim = A.rush;
    p.face = rb.x >= p.x ? 1 : -1;
    return;
  }
  if (p.engaged < 0 && released(rb)) {
    p.job = 'cover';
    p.target = 1;
    p.ax = p.x; p.ay = p.y;
    updateCover(s, p, dt);
    return;
  }
  updateRush(s, p, dt);
}

/**
 * The run read: linebackers step up to fill when they see the mesh, and the safety stops his drop. On a run
 * they keep filling until the handoff; on play action they're fooled for a moment. Returns true while reading.
 */
export function biteOnFake(s: SimState, p: SimPlayer, dt: number): boolean {
  const m = s.mesh;
  if (!m || s.phase !== 'pocket' || p.seat === s.desc.offense) return false;
  // A run and a fake look the same at first: that's the point of play action.
  const play = PLAYBOOK[s.desc.playbook];
  const kind = play?.kind ?? 'pass';
  if (kind !== 'pa' && kind !== 'run') return false;
  // A draw sells pass first, so nobody steps up for it.
  if (kind === 'run' && (play?.run?.mesh ?? 0) >= T.play.drawMesh) return false;
  const lb = p.role === 'LB' && (p.job === 'zone' || p.job === 'cover');
  const safety = p.i === 15 && (p.job === 'deep' || p.job === 'zone');
  if (!lb && !safety) return false;
  if (s.phaseT >= m.due + (lb ? T.ai.paBite : T.ai.paBiteSafety)) return false;
  const dir = s.desc.dir;
  if (lb) {
    moveTo(p, s.desc.los + dir * 1.2, p.y + (m.y - p.y) * 0.3, p.top * T.ai.paBiteSpeed, dt);
    p.anim = A.run;
    p.face = (-dir) as 1 | -1;
  } else {
    moveTo(p, p.x, p.y, p.top, dt);
    p.anim = A.stance;
  }
  return true;
}
