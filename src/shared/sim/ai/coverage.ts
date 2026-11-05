import { T } from '../tuning';
import { A, type SimPlayer, type SimState } from '../state';
import { moveTo } from './move';

/** Each DB or LB trails an assigned receiver, with lag from the difficulty table. */
export function updateCover(s: SimState, p: SimPlayer, dt: number): void {
  const dir = s.desc.dir;
  const ball = s.ball;
  if (s.phase === 'flight' && s.phaseT > T.ai.ballReactDelay + s.cfg.coverLag && Math.hypot(ball.ex - p.x, ball.ey - p.y) < T.ai.ballReact) {
    moveTo(p, ball.ex, ball.ey, p.top, dt);
    p.anim = A.run;
    return;
  }
  const rc = s.players[p.target];
  const lag = s.cfg.coverLag;
  const short = s.desc.toGo <= 3;
  const cushion = (short ? T.ai.coverCushionShort : T.ai.coverCushion) + (s.defCall === 'soft' ? T.ai.coverSoftExtra : 0);
  const tx = rc.x - rc.vx * lag + dir * cushion;
  const ty = rc.y - rc.vy * lag;
  const speed = p.top * T.ai.coverSpeed;
  const gap = (p.x - rc.x) * dir;
  moveTo(p, tx, ty, speed, dt);
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
  const ball = s.ball;
  if (s.phase === 'flight' && s.phaseT > T.ai.ballReactDelay + s.cfg.coverLag && Math.hypot(ball.ex - p.x, ball.ey - p.y) < T.ai.ballReact * 1.3) {
    moveTo(p, ball.ex, ball.ey, p.top, dt);
    p.anim = A.run;
    return;
  }
  const tx = deep ? deep.x + dir * 4 : p.x;
  const ty = deep ? T.field.center + (deep.y - T.field.center) * 0.65 : T.field.center;
  moveTo(p, Math.max(p.x * dir, tx * dir) * dir, ty, p.top * 0.9, dt);
  p.anim = Math.hypot(p.vx, p.vy) > 0.5 ? A.backpedal : A.stance;
  p.face = (-dir) as 1 | -1;
}

/** Zone: an underneath linebacker watches the middle. */
export function updateZone(s: SimState, p: SimPlayer, dt: number): void {
  const dir = s.desc.dir;
  const tx = p.ax + dir * 3;
  const qb = s.players[0];
  const ty = p.ay + (qb.y - T.field.center) * 0.5;
  moveTo(p, tx, ty, p.top * 0.7, dt);
  p.anim = Math.hypot(p.vx, p.vy) > 0.5 ? A.run : A.stance;
}
