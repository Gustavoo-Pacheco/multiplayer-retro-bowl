import { T } from '../tuning';
import { A, type SimPlayer, type SimState } from '../state';
import { moveTo } from './move';

/** Keeps a chaser's speed within reach of the player chased, so a mismatch in scores isn't a mismatch in everything. */
export function chaseSpeed(own: number, target: number, floor: number, ceiling: number): number {
  return Math.max(target + floor, Math.min(target + ceiling, own));
}

/** After a catch or handoff, defenders aim for where the runner is heading. */
export function updatePursuit(s: SimState, p: SimPlayer, dt: number): void {
  const h = s.ball.holder;
  if (h < 0) return;
  const r = s.players[h];
  if (p.engaged >= 0) {
    const b = s.players[p.engaged];
    if (s.t >= p.shed) {
      b.engaged = -1;
      p.engaged = -1;
      p.freeUntil = s.t + T.ai.reblockCd;
    } else {
      p.vx *= 0.8; p.vy *= 0.8;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.anim = A.push;
      return;
    }
  }
  const d = Math.hypot(r.x - p.x, r.y - p.y);
  const t = Math.min(T.ai.pursuitLead, d / Math.max(1, p.top));
  const tx = r.x + r.vx * t;
  const ty = r.y + r.vy * t;
  moveTo(p, tx, ty, chaseSpeed(p.top * T.ai.pursuitSpeed, r.top * T.run.carryMult, T.ai.pursuitFloor, T.ai.pursuitCeiling), dt);
  p.anim = A.run;
  p.face = p.vx >= 0 ? 1 : -1;
}
