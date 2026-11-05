// Draws one frame of a play. Used in the same way by the controller, the watcher and replays.
import type { Frame } from '../../shared/protocol';
import type { Role } from '../../shared/data/roster';
import { T } from '../../shared/sim/tuning';
import { A, type PlayDesc, type Seat } from '../../shared/sim/state';
import { ATLAS } from '../art/atlas';
import { CELL_H, CELL_W, cellIndex, composedCells } from '../art/compose';
import type { Kit } from '../art/palette';
import type { BuildName } from '../art/parts';
import { POSES } from '../art/poses';
import { drawField, type FieldArt } from './field';
import { drawText, textWidth } from './font';
import { FIELD_TOP, PX, PY, screenX, screenY, W } from './view';

export interface SceneInfo {
  desc: PlayDesc;
  seats: Seat[];
  roles: Role[];
  slots: number[];
  kits: [Kit, Kit];
  routes: { i: number; pts: number[]; color?: string }[];
  firstDownX: number | null;
  aimAlpha: number;
  field: FieldArt;
  skins: number[];
  stars: boolean[];
  names: string[];
}

export interface SceneOpts {
  nameTags: boolean;
  starMarkers: boolean;
  /** Replaces a player's pose, for celebrations. */
  override: ((i: number) => string | null) | null;
  ref: { x: number; y: number; pose: string; face: number } | null;
  /** Someone being helped off, walking toward the sideline. */
  helped: { x: number; y: number; seat: Seat; skin: number; tick: number } | null;
  trail: readonly { x: number; y: number; z: number }[];
  /** True while the crowd has something to cheer about. */
  excited: boolean;
  /** Time in ms, for sideline loops that keep moving when the play doesn't. */
  now: number;
}

export const DEFAULT_SCENE: SceneOpts = { nameTags: false, starMarkers: true, override: null, ref: null, helped: null, trail: [], excited: false, now: 0 };

const ANIM_POSE: string[] = [];
for (const [name, value] of Object.entries(A)) ANIM_POSE[value] = name;

/** Which sprite build a position plays in. */
export function buildFor(role: Role): BuildName {
  return role === 'OL' || role === 'DL' || role === 'TE' ? 'big' : role === 'K' ? 'slim' : 'std';
}

/** The pose for a position and animation from the sim. */
export function poseFor(role: Role, anim: number): string {
  const name = ANIM_POSE[anim] ?? 'stance';
  if (name !== 'stance') return name;
  if (role === 'OL' || role === 'DL') return 'stance3';
  if (role === 'QB') return 'stance';
  if (role === 'K') return 'kickStance';
  return 'ready';
}

const SLOW = new Set(['stance', 'ready', 'stance3', 'kickStance', 'hold']);

function frameIndex(name: string, tick: number, i: number): number {
  if (POSES[name].length === 1 || SLOW.has(name)) return 0;
  return Math.floor((tick + i * 5) / (name === 'run' || name === 'runBall' || name === 'scramble' || name === 'kickApproach' ? 7 : 14));
}

// --- Sideline figures -----------------------------------------------------

interface Figure { x: number; kind: 'cheer' | 'coach' | 'bench' | 'photo'; skin: number; side: 0 | 1 }
const FIGURES: Figure[] = [];
{
  const pattern: Figure['kind'][] = ['cheer', 'bench', 'coach', 'bench', 'cheer', 'photo'];
  for (let x = 2, n = 0; x < T.field.len; x += 6.5, n++) {
    FIGURES.push({ x, kind: pattern[n % pattern.length], skin: (n * 3) % 4, side: x < T.field.len / 2 ? 0 : 1 });
  }
}

function drawSideline(ctx: CanvasRenderingContext2D, cam: number, kits: [Kit, Kit], o: SceneOpts): void {
  const y = FIELD_TOP - 3;
  const beat = Math.floor(o.now / 420);
  FIGURES.forEach((f, n) => {
    const sx = screenX(f.x, cam);
    if (sx < -20 || sx > W + 20) return;
    const atlas = ATLAS.get(kits[f.side], f.skin);
    const step = beat + n;
    if (f.kind === 'cheer') atlas.draw(ctx, 'cheer', o.excited ? 'cheer' : 'cheerIdle', step, sx, y, 1);
    else if (f.kind === 'coach') atlas.draw(ctx, 'coach', 'coachIdle', Math.floor(step / 4), sx, y, n % 2 ? 1 : -1);
    else if (f.kind === 'photo') atlas.draw(ctx, 'photo', 'photoIdle', Math.floor(step / 3), sx, y + 1, n % 2 ? 1 : -1);
    else atlas.draw(ctx, 'std', o.excited ? 'celebrate' : 'benchIdle', o.excited ? step : Math.floor(step / 5), sx, y, n % 2 ? 1 : -1);
  });
}

// --- Small things on the field --------------------------------------------

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number, spin: boolean): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const turn = spin ? Math.floor(tick / 4) % 3 : 0;
  ctx.fillStyle = '#7a4a22';
  if (turn === 0) { ctx.fillRect(px - 2, py - 1, 5, 3); ctx.fillStyle = '#f4f4ee'; ctx.fillRect(px, py - 1, 1, 1); }
  else if (turn === 1) { ctx.fillRect(px - 1, py - 2, 3, 2); ctx.fillRect(px, py - 1, 3, 2); ctx.fillStyle = '#f4f4ee'; ctx.fillRect(px + 1, py - 1, 1, 1); }
  else { ctx.fillRect(px - 1, py - 2, 3, 5); ctx.fillStyle = '#f4f4ee'; ctx.fillRect(px, py, 1, 1); }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#17181c';
  ctx.fillRect(x - 3, y - 1, 7, 3);
  ctx.fillRect(x - 1, y - 3, 3, 7);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x - 2, y, 5, 1);
  ctx.fillRect(x, y - 2, 1, 5);
  ctx.fillRect(x - 1, y - 1, 3, 3);
}

function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, 11, 4, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRoute(ctx: CanvasRenderingContext2D, f: Frame, r: SceneInfo['routes'][number], cam: number): void {
  const X = (x: number) => screenX(x, cam);
  const startX = X(f.px[r.i]);
  const startY = screenY(f.py[r.i]);
  ctx.strokeStyle = r.color ?? '#7dff7d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  let lx = startX;
  let ly = startY;
  let px = startX;
  let py = startY;
  for (let k = 0; k + 1 < r.pts.length; k += 2) {
    px = lx; py = ly;
    lx = X(r.pts[k]); ly = screenY(r.pts[k + 1]);
    ctx.lineTo(lx, ly);
  }
  ctx.stroke();
  // An arrowhead at the route's end.
  const a = Math.atan2(ly - py, lx - px);
  ctx.fillStyle = r.color ?? '#7dff7d';
  ctx.beginPath();
  ctx.moveTo(lx + Math.cos(a) * 3, ly + Math.sin(a) * 3);
  ctx.lineTo(lx + Math.cos(a + 2.4) * 5, ly + Math.sin(a + 2.4) * 5);
  ctx.lineTo(lx + Math.cos(a - 2.4) * 5, ly + Math.sin(a - 2.4) * 5);
  ctx.closePath();
  ctx.fill();
}

const REF_KIT: Kit = { helmet: '#17181c', jersey: '#f4f4ee', trim: '#17181c', pants: '#f4f4ee', number: '#17181c' };

export function drawScene(ctx: CanvasRenderingContext2D, f: Frame, info: SceneInfo, cam: number, opts: SceneOpts = DEFAULT_SCENE): void {
  drawField(ctx, info.field, cam);
  drawSideline(ctx, cam, info.kits, opts);
  const X = (x: number) => screenX(x, cam);
  const Y = screenY;
  const fieldH = T.view.fieldH;
  // Line of scrimmage and first-down line, with a chain marker on the far sideline.
  ctx.fillStyle = '#4aa3ff';
  ctx.fillRect(Math.round(X(info.desc.los)), Y(0), 2, fieldH);
  if (info.firstDownX !== null) {
    const fx = Math.round(X(info.firstDownX));
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(fx, Y(0), 2, fieldH);
    ctx.fillStyle = '#ff8a1e';
    ctx.fillRect(fx - 1, Y(0) - 11, 4, 11);
    ctx.fillRect(fx - 3, Y(0) - 14, 8, 4);
  }
  // Route lines, before the snap and while the QB holds the ball.
  if (f.phase === 'pre' || f.phase === 'pocket') for (const r of info.routes) drawRoute(ctx, f, r, cam);

  // The ball's trail through the air.
  for (let i = 0; i < opts.trail.length; i++) {
    const p = opts.trail[i];
    ctx.fillStyle = `rgba(255,255,255,${(0.08 + (0.32 * i) / opts.trail.length).toFixed(2)})`;
    ctx.fillRect(Math.round(X(p.x)), Math.round(Y(p.y) - p.z * PY), 2, 2);
  }

  if (f.carrier >= 0 && f.carrier < f.px.length && f.phase !== 'dead') drawRing(ctx, X(f.px[f.carrier]), Y(f.py[f.carrier]));

  // Players, referee and helpers, far ones first.
  const order = Array.from({ length: f.px.length }, (_, i) => i).sort((a, b) => f.py[a] - f.py[b]);
  let refDrawn = !opts.ref;
  const drawRef = () => {
    if (refDrawn || !opts.ref) return;
    refDrawn = true;
    const r = opts.ref;
    const sx = X(r.x);
    const sy = Y(r.y);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(Math.round(sx) - 6, Math.round(sy) - 1, 12, 3);
    ATLAS.get(REF_KIT, 1).draw(ctx, 'ref', r.pose, Math.floor(opts.now / 300), sx, sy, r.face);
  };
  const seats = info.seats;
  for (const i of order) {
    if (opts.ref && !refDrawn && f.py[i] >= opts.ref.y) drawRef();
    const sx = Math.round(X(f.px[i]));
    const sy = Math.round(Y(f.py[i]));
    if (sx < -24 || sx > W + 24) continue;
    const seat = seats[i] ?? 0;
    const role = info.roles[i] ?? 'WR';
    const build = buildFor(role);
    let pose = opts.override?.(i) ?? poseFor(role, f.anim[i]);
    if (f.stunned[i] && pose !== 'getUp' && pose !== 'tackle' && pose !== 'fumble') pose = 'tackled';
    const atlas = ATLAS.get(info.kits[seat], info.skins[i] ?? 0);
    const frame = frameIndex(pose, f.tick, i);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(sx - 6, sy - 1, 12, 3);
    const face = f.face[i] < 0 ? -1 : 1;
    atlas.draw(ctx, build, pose, frame, sx, sy, face);
    if (f.carrier === i && f.phase !== 'dead') {
      const cell = composedCells()[cellIndex(build, pose, frame)];
      drawBall(ctx, sx + face * (cell.hand[0] - CELL_W / 2), sy + (cell.hand[1] - (CELL_H - 1)), f.tick, false);
    }
    if (opts.starMarkers && info.stars[i]) drawStar(ctx, sx, sy - 31);
    if (opts.nameTags && info.names[i] && (f.carrier === i || info.routes.some((r) => r.i === i)) && (f.phase === 'pre' || f.phase === 'pocket' || f.carrier === i)) {
      const tag = info.names[i].toUpperCase().slice(0, 12);
      const tw = textWidth(tag);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(sx + 9, sy - 19, tw + 3, 9);
      drawText(ctx, tag, sx + 11, sy - 18, '#fff');
    }
    if (f.carrier === i && f.meter > 0 && f.phase !== 'dead') {
      // The truck meter.
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - 11, sy - 34, 22, 4);
      ctx.fillStyle = '#ff8a1e';
      ctx.fillRect(sx - 10, sy - 33, Math.round(20 * Math.min(1, f.meter)), 2);
    }
  }
  drawRef();
  if (opts.helped) {
    const h = opts.helped;
    const sx = X(h.x);
    const sy = Y(h.y);
    const atlas = ATLAS.get(info.kits[h.seat], h.skin);
    atlas.draw(ctx, 'std', 'run', Math.floor(h.tick / 16), sx + 11, sy, 1);
    atlas.draw(ctx, 'std', 'helped', Math.floor(h.tick / 16), sx, sy, 1);
  }
  // The ball, when nobody has it.
  if (f.carrier < 0 || f.phase === 'dead') {
    const bx = X(f.bx);
    const by = Y(f.by);
    if (f.bz > 0.1) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.round(bx) - 2, Math.round(by), 4, 2); }
    drawBall(ctx, bx, by - f.bz * PY, f.tick, f.bz > 0.3);
  }
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
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(tx), Math.round(ty), 1, 1);
    ctx.globalAlpha = 1;
  }
}
