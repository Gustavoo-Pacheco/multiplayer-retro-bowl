import { T } from '../tuning';
import { dirOf, type SimPlayer, type SimState } from '../state';

/** Returns a lateral speed that takes the runner toward open space and the goal. */
export function autoSteer(s: SimState, p: SimPlayer): number {
  const R = T.run;
  const dir = dirOf(s, p.seat);
  const look = R.autoLookAhead;
  const n = R.autoLanes;
  let bestY = p.y;
  let best = -1e9;
  for (let k = 0; k < n; k++) {
    const offset = ((k - (n - 1) / 2) * look) / (n - 1) * 1.1;
    const ly = Math.max(R.autoSideMargin, Math.min(T.field.width - R.autoSideMargin, p.y + offset));
    const ax = p.x + dir * look;
    let minD = 99;
    for (const d of s.players) {
      if (d.seat === p.seat || d.stun > 0 || d.engaged >= 0) continue;
      const ahead = (d.x - p.x) * dir;
      if (ahead < -2) continue;
      const dist = Math.hypot(d.x - ax, d.y - ly);
      if (dist < minD) minD = dist;
    }
    const score = minD - Math.abs(ly - p.y) * 0.12;
    if (score > best) { best = score; bestY = ly; }
  }
  const dy = bestY - p.y;
  return Math.max(-R.autoLateral, Math.min(R.autoLateral, dy * 2));
}
