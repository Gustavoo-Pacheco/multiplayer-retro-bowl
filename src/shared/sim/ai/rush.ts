import { rnd } from '../rng';
import { T } from '../tuning';
import { A, type SimPlayer, type SimState } from '../state';
import { moveTo } from './move';

/** How long a rusher stays locked with a blocker. Strength decides who wins. */
export function rollShed(s: SimState, rusher: SimPlayer, blocker: SimPlayer): number {
  const a = T.ai;
  const base = s.cfg.sackTime * (a.rushShedLo + (a.rushShedHi - a.rushShedLo) * rnd(s));
  const edge = 1 + a.blockStrFactor * (Math.max(blocker.blk, blocker.str) - rusher.str);
  return s.t + base * Math.max(0.4, edge);
}

/** DL fight blockers, then close on the QB. */
export function updateRush(s: SimState, p: SimPlayer, dt: number): void {
  const qb = s.players[s.ball.holder >= 0 ? s.ball.holder : 0];
  if (p.engaged >= 0) {
    const b = s.players[p.engaged];
    if (s.t >= p.shed || s.force === 'sack') {
      b.engaged = -1;
      b.stun = T.ai.blockShedStun;
      p.engaged = -1;
    } else {
      const dx = qb.x - p.x;
      const dy = qb.y - p.y;
      const n = Math.hypot(dx, dy) || 1;
      const push = Math.max(0, T.ai.pushBase + T.ai.pushPerStr * (p.str - Math.max(b.str, b.blk)));
      p.vx = (dx / n) * push;
      p.vy = (dy / n) * push;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.anim = A.push;
      p.face = dx >= 0 ? 1 : -1;
      return;
    }
  }
  const speed = Math.min(p.top * T.ai.rushSpeed, T.ai.freeRushSpeedCap);
  moveTo(p, qb.x, qb.y, speed, dt);
  p.anim = A.rush;
  p.face = qb.x >= p.x ? 1 : -1;
}
