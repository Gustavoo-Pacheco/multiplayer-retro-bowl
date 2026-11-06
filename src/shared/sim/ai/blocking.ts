import { T } from '../tuning';
import { PLAYBOOK, isRunKind } from '../../data/playbook';
import { rollShed } from './rush';
import { A, type SimPlayer, type SimState } from '../state';
import { moveTo, stopMoving } from './move';

function nearestThreat(s: SimState, p: SimPlayer, protect: SimPlayer): SimPlayer | null {
  let best: SimPlayer | null = null;
  let bd = 1e9;
  for (const q of s.players) {
    if (q.seat === p.seat || q.stun > 0 || s.t < q.freeUntil) continue;
    if (q.engaged >= 0 && q.engaged !== p.i) continue;
    const dp = Math.hypot(q.x - p.x, q.y - p.y);
    const dq = Math.hypot(q.x - protect.x, q.y - protect.y);
    const score = dp + dq * 0.35;
    if (score < bd) { bd = score; best = q; }
  }
  return best;
}

/** The nearest free defender around a downfield blocker, for stalk and screen blocks. */
function nearestAround(s: SimState, p: SimPlayer, range: number): SimPlayer | null {
  let best: SimPlayer | null = null;
  let bd = range;
  const dir = s.desc.dir;
  for (const q of s.players) {
    if (q.seat === p.seat || q.stun > 0 || s.t < q.freeUntil || q.engaged >= 0) continue;
    // A defender behind the blocker is someone else's problem.
    const behind = (p.x - q.x) * dir > 1.5 ? 3 : 0;
    const d = Math.hypot(q.x - p.x, q.y - p.y) + behind;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Whether this snap is a designed run, where blocks are drive blocks rather than pass sets. */
export function isRunPlay(s: SimState): boolean {
  const k = PLAYBOOK[s.desc.playbook]?.kind;
  return !!k && isRunKind(k) && (s.desc.type === 'scrimmage' || s.desc.type === 'twoPoint');
}

/** Whether the line is pass blocking: on a pass, and on a draw until the handoff, which is what sells it. */
function passSet(s: SimState): boolean {
  if (s.phase !== 'pocket') return false;
  if (!isRunPlay(s)) return true;
  return (PLAYBOOK[s.desc.playbook]?.run?.mesh ?? 0) >= T.play.drawMesh;
}

function engage(s: SimState, p: SimPlayer, r: SimPlayer, hold: number): void {
  r.engaged = p.i;
  p.engaged = r.i;
  const str = Math.max(p.blk, p.str) - r.str;
  if (hold > 0) r.shed = s.t + Math.max(0.25, hold + T.ai.blockHoldPerStr * str);
  else if (passSet(s)) r.shed = rollShed(s, r, p);
  else r.shed = s.t + Math.max(0.2, (isRunPlay(s) ? T.ai.runBlockHold : T.ai.blockHold) + T.ai.blockHoldPerStr * str);
  p.anim = A.block;
}

/** Holds a block already made, staying between the defender and the ball. Returns false if it broke. */
function holdBlock(s: SimState, p: SimPlayer, protect: SimPlayer, dt: number): boolean {
  if (p.engaged < 0) return false;
  const r = s.players[p.engaged];
  if (r.engaged !== p.i) { p.engaged = -1; return false; }
  const dx = r.x - protect.x;
  const dy = r.y - protect.y;
  const n = Math.hypot(dx, dy) || 1;
  moveTo(p, r.x - (dx / n) * T.ai.blockKeepOff, r.y - (dy / n) * T.ai.blockKeepOff, p.top * 1.2, dt);
  p.anim = r.vx !== 0 && Math.hypot(r.vx, r.vy) > 0.5 ? A.pushed : A.block;
  p.face = r.x >= p.x ? 1 : -1;
  return true;
}

const protectOf = (s: SimState): SimPlayer => s.players[s.ball.holder >= 0 ? s.ball.holder : 0];

/** OL and TE engage the nearest threats. Strength decides who gives ground. */
export function updateBlocker(s: SimState, p: SimPlayer, dt: number): void {
  const protect = protectOf(s);
  if (holdBlock(s, p, protect, dt)) return;
  const r = nearestThreat(s, p, protect);
  if (!r) { stopMoving(p, dt); p.anim = A.stance; return; }
  const dx = r.x - protect.x;
  const dy = r.y - protect.y;
  const n = Math.hypot(dx, dy) || 1;
  moveTo(p, r.x - (dx / n) * T.ai.blockKeepOff, r.y - (dy / n) * T.ai.blockKeepOff, p.top, dt);
  p.anim = A.run;
  p.face = r.x >= p.x ? 1 : -1;
  if (Math.hypot(r.x - p.x, r.y - p.y) < T.ai.blockEngage && r.engaged < 0) engage(s, p, r, 0);
}

/** A receiver blocks the nearest defender around him, for a run or a screen. */
export function updateStalk(s: SimState, p: SimPlayer, dt: number): void {
  const protect = protectOf(s);
  if (holdBlock(s, p, protect, dt)) return;
  const r = nearestAround(s, p, T.ai.stalkRange);
  if (!r) { moveTo(p, p.x + s.desc.dir, p.y, p.top * 0.5, dt); p.anim = A.run; return; }
  const dx = r.x - protect.x;
  const dy = r.y - protect.y;
  const n = Math.hypot(dx, dy) || 1;
  moveTo(p, r.x - (dx / n) * T.ai.blockKeepOff, r.y - (dy / n) * T.ai.blockKeepOff, p.top * 0.95, dt);
  p.anim = A.run;
  p.face = r.x >= p.x ? 1 : -1;
  if (Math.hypot(r.x - p.x, r.y - p.y) < T.ai.blockEngage) engage(s, p, r, T.ai.stalkHold);
}

/** A pulling lineman or a lead back runs his path to the hole, blocking the first defender who shows up. */
export function updatePath(s: SimState, p: SimPlayer, dt: number): void {
  const rt = p.route;
  const done = () => { p.job = s.phase === 'run' ? 'lead' : 'block'; p.route = null; };
  if (!rt || p.routeI >= rt.length) { done(); return; }
  for (const q of s.players) {
    if (q.seat === p.seat || q.stun > 0 || q.engaged >= 0 || s.t < q.freeUntil) continue;
    if (Math.hypot(q.x - p.x, q.y - p.y) < T.ai.blockEngage * 1.3 && p.routeI >= 2) { engage(s, p, q, 0); done(); return; }
  }
  moveTo(p, rt[p.routeI], rt[p.routeI + 1], p.top, dt);
  if (Math.hypot(rt[p.routeI] - p.x, rt[p.routeI + 1] - p.y) < T.play.routeArriveRadius + 0.2) p.routeI += 2;
  p.anim = A.run;
  p.face = p.vx >= 0 ? 1 : -1;
}

/** A screen: the linemen let their men go and leak out to set up in front of the catch. */
export function releaseForScreen(s: SimState): void {
  const play = PLAYBOOK[s.desc.playbook];
  if (!play || play.kind !== 'screen' || play.rb !== 'screen' || s.phase !== 'pocket' || s.phaseT < T.play.screenRelease) return;
  const rb = s.players[1];
  const dir = s.desc.dir;
  const side = rb.route && rb.route.length >= 2 ? Math.sign(rb.route[rb.route.length - 1] - T.field.center) || 1 : 1;
  let k = 0;
  for (const i of [5, 6, 7]) {
    const p = s.players[i];
    if (p.job !== 'block') continue;
    if (p.engaged >= 0) { const r = s.players[p.engaged]; if (r.engaged === p.i) r.engaged = -1; p.engaged = -1; }
    p.job = 'release';
    p.route = [s.desc.los + dir * (0.5 + k * 0.6), Math.max(0.8, Math.min(T.field.width - 0.8, T.field.center + side * (2.4 + k * 1.5)))];
    p.routeI = 0;
    k += 1;
  }
}

export function updateRelease(s: SimState, p: SimPlayer, dt: number): void {
  const rt = p.route;
  if (!rt || p.routeI >= rt.length) { p.job = 'stalk'; p.route = null; updateStalk(s, p, dt); return; }
  moveTo(p, rt[0], rt[1], p.top, dt);
  if (Math.hypot(rt[0] - p.x, rt[1] - p.y) < 0.7) p.routeI = rt.length;
  p.anim = A.run;
  p.face = p.vx >= 0 ? 1 : -1;
}
