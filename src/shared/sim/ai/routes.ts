import { T } from '../tuning';
import { A, type SimPlayer, type SimState } from '../state';
import { holdEdge, moveTo, steer } from './move';

/** Runs the route, then continues along its last leg. */
export function updateRoute(s: SimState, p: SimPlayer, dt: number): void {
  const rt = p.route;
  if (!rt) { p.job = 'block'; return; }
  // A pressed receiver fights through the jam before he gets going.
  const speed = p.top * (p.jam > 0 && s.t - s.snapT < p.jam ? T.ai.pressSlow : 1);
  p.anim = A.run;
  if (p.routeI < rt.length) {
    const tx = rt[p.routeI];
    const ty = rt[p.routeI + 1];
    const y0 = p.y;
    moveTo(p, tx, ty, speed, dt);
    holdEdge(p, y0);
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
  if (p.y < T.field.routeRoom && uy < 0) uy = 0;
  if (p.y > T.field.width - T.field.routeRoom && uy > 0) uy = 0;
  // Never drift back toward the line once the route is run: a route squeezed by the sideline can end facing back.
  if (ux * s.desc.dir < 0) ux = 0;
  if (Math.abs(uy) < 0.2 && Math.abs(ux) < 0.2) { ux = s.desc.dir; uy = 0; }
  const m = Math.hypot(ux, uy) || 1;
  const y0 = p.y;
  steer(p, (ux / m) * speed, (uy / m) * speed, dt);
  holdEdge(p, y0);
  p.x = Math.max(0.3, Math.min(T.field.len - 0.3, p.x));
}
