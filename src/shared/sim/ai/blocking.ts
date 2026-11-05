import { T } from '../tuning';
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

/** OL and TE engage the nearest threats. Strength decides who gives ground. */
export function updateBlocker(s: SimState, p: SimPlayer, dt: number): void {
  const protect = s.players[s.ball.holder >= 0 ? s.ball.holder : 0];
  if (p.engaged >= 0) {
    const r = s.players[p.engaged];
    if (r.engaged !== p.i) { p.engaged = -1; }
    else {
      const dx = r.x - protect.x;
      const dy = r.y - protect.y;
      const n = Math.hypot(dx, dy) || 1;
      moveTo(p, r.x - (dx / n) * T.ai.blockKeepOff, r.y - (dy / n) * T.ai.blockKeepOff, p.top * 1.2, dt);
      p.anim = r.vx !== 0 && Math.hypot(r.vx, r.vy) > 0.5 ? A.pushed : A.block;
      p.face = r.x >= p.x ? 1 : -1;
      return;
    }
  }
  const r = nearestThreat(s, p, protect);
  if (!r) { stopMoving(p, dt); p.anim = A.stance; return; }
  const dx = r.x - protect.x;
  const dy = r.y - protect.y;
  const n = Math.hypot(dx, dy) || 1;
  moveTo(p, r.x - (dx / n) * T.ai.blockKeepOff, r.y - (dy / n) * T.ai.blockKeepOff, p.top, dt);
  p.anim = A.run;
  p.face = r.x >= p.x ? 1 : -1;
  if (Math.hypot(r.x - p.x, r.y - p.y) < T.ai.blockEngage && r.engaged < 0) {
    r.engaged = p.i;
    p.engaged = r.i;
    r.shed = s.phase === 'pocket' ? rollShed(s, r, p) : s.t + Math.max(0.2, T.ai.blockHold + T.ai.blockHoldPerStr * (Math.max(p.blk, p.str) - r.str));
    p.anim = A.block;
  }
}
