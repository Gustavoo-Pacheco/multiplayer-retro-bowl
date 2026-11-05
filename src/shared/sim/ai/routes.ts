import { T } from '../tuning';
import { A, type SimPlayer, type SimState } from '../state';
import { moveTo, steer } from './move';

/** Runs the route, then continues along its last leg. */
export function updateRoute(s: SimState, p: SimPlayer, dt: number): void {
  const rt = p.route;
  if (!rt) { p.job = 'block'; return; }
  const speed = p.top;
  p.anim = A.run;
  if (p.routeI < rt.length) {
    const tx = rt[p.routeI];
    const ty = rt[p.routeI + 1];
    moveTo(p, tx, ty, speed, dt);
    if (Math.hypot(tx - p.x, ty - p.y) < T.play.routeArriveRadius) p.routeI += 2;
    return;
  }
  if (p.routeStop) {
    steer(p, 0, 0, dt);
    p.anim = A.stance;
    return;
  }
  // Keep going the same way, staying in bounds.
  const n = Math.hypot(p.vx, p.vy) || 1;
  let ux = p.vx / n;
  let uy = p.vy / n;
  if (p.y < 0.6 && uy < 0) uy = 0;
  if (p.y > T.field.width - 0.6 && uy > 0) uy = 0;
  if (uy === 0 && Math.abs(ux) < 0.2) ux = s.desc.dir;
  const m = Math.hypot(ux, uy) || 1;
  steer(p, (ux / m) * speed, (uy / m) * speed, dt);
  p.x = Math.max(0.3, Math.min(T.field.len - 0.3, p.x));
}
