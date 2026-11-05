// Draws one frame of a play. Used in the same way by the controller and the watcher.
import type { Frame } from '../../shared/protocol';
import type { Role } from '../../shared/data/roster';
import { T } from '../../shared/sim/tuning';
import { A, type PlayDesc, type Seat } from '../../shared/sim/state';
import { drawField, type FieldArt } from './field';
import { PX, PY, screenX, screenY } from './view';

export interface Kit { helmet: string; jersey: string; trim: string; pants: string }

export interface SceneInfo {
  desc: PlayDesc;
  seats: Seat[];
  roles: Role[];
  kits: [Kit, Kit];
  routes: { i: number; pts: number[]; color?: string }[];
  firstDownX: number | null;
  aimAlpha: number;
  field: FieldArt;
}

export function drawScene(ctx: CanvasRenderingContext2D, f: Frame, info: SceneInfo, cam: number): void {
  drawField(ctx, info.field, cam);
  const X = (x: number) => screenX(x, cam);
  const Y = screenY;
  // Line of scrimmage and first-down line.
  ctx.fillStyle = '#4aa3ff';
  ctx.fillRect(Math.round(X(info.desc.los)), Y(0), 2, T.view.fieldH);
  if (info.firstDownX !== null) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(Math.round(X(info.firstDownX)), Y(0), 2, T.view.fieldH); }
  // Route lines, before the snap and while the QB holds the ball.
  if (f.phase === 'pre' || f.phase === 'pocket') {
    for (const r of info.routes) {
      ctx.strokeStyle = '#7dff7d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(f.px[r.i]), Y(f.py[r.i]));
      for (let k = 0; k + 1 < r.pts.length; k += 2) ctx.lineTo(X(r.pts[k]), Y(r.pts[k + 1]));
      ctx.stroke();
    }
  }
  // Players, far ones first.
  const order = Array.from({ length: f.px.length }, (_, i) => i).sort((a, b) => f.py[a] - f.py[b]);
  for (const i of order) {
    const sx = Math.round(X(f.px[i]));
    const sy = Math.round(Y(f.py[i]));
    const kit = info.kits[info.seats[i]];
    const down = f.anim[i] === A.tackled || f.anim[i] === A.sacked || f.stunned[i];
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(sx - 6, sy - 1, 12, 3);
    if (down) {
      ctx.fillStyle = kit.jersey; ctx.fillRect(sx - 9, sy - 6, 14, 6);
      ctx.fillStyle = kit.helmet; ctx.fillRect(sx + 5, sy - 7, 5, 5);
    } else {
      ctx.fillStyle = kit.pants; ctx.fillRect(sx - 4, sy - 9, 8, 9);
      ctx.fillStyle = kit.jersey; ctx.fillRect(sx - 5, sy - 18, 10, 9);
      ctx.fillStyle = kit.helmet; ctx.fillRect(sx - 3, sy - 24, 6, 6);
    }
  }
  // Ball.
  const bx = X(f.bx);
  const by = Y(f.by);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(Math.round(bx) - 2, Math.round(by), 4, 2);
  ctx.fillStyle = '#7a4a22';
  ctx.fillRect(Math.round(bx) - 2, Math.round(by - f.bz * PY) - 1, 5, 3);
  // Aim cursor.
  if (f.aimOn && f.phase === 'pocket') {
    const qx = X(f.px[0]);
    const qy = Y(f.py[0]);
    const tx = qx + f.ax * PX;
    const ty = qy + f.ay * PY;
    ctx.globalAlpha = Math.max(0.05, info.aimAlpha);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(qx, qy - 10); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
