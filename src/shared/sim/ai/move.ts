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

/**
 * Stops outward drift at routeRoom, given where the player was before this tick's move. A receiver
 * at full speed can't turn in time and would swing past the end of an out route, over the far
 * sideline's bench, with his man behind him. Neither is ever pulled back in.
 */
export function holdEdge(p: SimPlayer, y0: number): void {
  const lo = T.field.routeRoom;
  const hi = T.field.width - lo;
  if (p.y < lo && p.y < y0) { p.y = Math.min(y0, lo); p.vy = Math.max(0, p.vy); }
  else if (p.y > hi && p.y > y0) { p.y = Math.max(y0, hi); p.vy = Math.min(0, p.vy); }
}

export function stopMoving(p: SimPlayer, dt: number): void { steer(p, 0, 0, dt); }
