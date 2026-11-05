import { T } from '../tuning';
import type { SimPlayer } from '../state';

/** Steers toward a desired velocity with limited acceleration. */
export function steer(p: SimPlayer, dvx: number, dvy: number, dt: number): void {
  const max = T.speed.accel * dt;
  const ax = dvx - p.vx;
  const ay = dvy - p.vy;
  const n = Math.hypot(ax, ay);
  if (n > max) { p.vx += (ax / n) * max; p.vy += (ay / n) * max; }
  else { p.vx = dvx; p.vy = dvy; }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

export function moveTo(p: SimPlayer, tx: number, ty: number, speed: number, dt: number): void {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const n = Math.hypot(dx, dy);
  if (n < 0.05) { steer(p, 0, 0, dt); return; }
  const v = Math.min(speed, n * 8);
  steer(p, (dx / n) * v, (dy / n) * v, dt);
}

export function stopMoving(p: SimPlayer, dt: number): void { steer(p, 0, 0, dt); }
