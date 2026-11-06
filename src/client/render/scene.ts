// Draws one frame of a play. Used in the same way by the controller, the watcher and replays.
import type { Frame } from '../../shared/protocol';
import type { Role } from '../../shared/data/roster';
import { T } from '../../shared/sim/tuning';
import { A, type PlayDesc, type Seat, type SimState } from '../../shared/sim/state';
import { ATLAS } from '../art/atlas';
import { CELL_H, CELL_W, cellIndex, composedCells } from '../art/compose';
import type { Kit } from '../art/palette';
import type { BuildName } from '../art/parts';
import { POSES } from '../art/poses';
import { drawField, type FieldArt } from './field';
import { drawText, textWidth } from './font';
import { FIELD_TOP, FIG, PX, PY, screenX, screenY, W } from './view';

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
    if (f.kind === 'cheer') atlas.draw(ctx, 'cheer', o.excited ? 'cheer' : 'cheerIdle', step, sx, y, 1, FIG);
    else if (f.kind === 'coach') atlas.draw(ctx, 'coach', 'coachIdle', Math.floor(step / 4), sx, y, n % 2 ? 1 : -1, FIG);
    else if (f.kind === 'photo') atlas.draw(ctx, 'photo', 'photoIdle', Math.floor(step / 3), sx, y + 1, n % 2 ? 1 : -1, FIG);
    else atlas.draw(ctx, 'std', o.excited ? 'celebrate' : 'benchIdle', o.excited ? step : Math.floor(step / 5), sx, y, n % 2 ? 1 : -1, FIG);
  });
}

// --- Small things on the field --------------------------------------------

/** Screen pixels per art pixel for figures and the ball, which are drawn smaller than the field. */
const U = 2 * FIG;

/** A figure's shadow, at its feet. */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(Math.round(x) - 4.5, Math.round(y) - 1, 9, 2.5);
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number, spin: boolean): void {
  const px = Math.round(x / U) * U;
  const py = Math.round(y / U) * U;
  const turn = spin ? Math.floor(tick / 4) % 3 : 0;
  ctx.fillStyle = '#17181c';
  if (turn === 2) ctx.fillRect(px - 2 * U, py - 3 * U, 4 * U, 6 * U);
  else ctx.fillRect(px - 3 * U, py - 2 * U, 6 * U, 4 * U);
  ctx.fillStyle = '#9c5a24';
  if (turn === 2) ctx.fillRect(px - U, py - 2 * U, 2 * U, 4 * U);
  else ctx.fillRect(px - 2 * U, py - U, 4 * U, 2 * U);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px - (turn === 1 ? U : 0), py - (turn === 1 ? U : 0), U, U);
}

// --- The pass in flight: a tight spiral -----------------------------------

/** Headings the spiral is drawn at, over half a turn. A football looks the same end to end. */
const SPIRAL_HEADINGS = 16;
/** Roll steps per turn, and ticks per step. The laces show for the front half of each turn. */
const SPIRAL_ROLLS = 6;
const SPIRAL_TICKS = 2;
/** Half length and half width in art pixels. Narrower than this and the diagonals turn into squares. */
const SPIRAL_LONG = 4.0;
const SPIRAL_WIDE = 2.2;
const SPIRAL_LACE = 1.6;

type Cells = { i: number; j: number; ink: string }[];
const spiralCells = new Map<number, Cells>();

/** One spiral frame on the art grid: outline, leather with a shaded underside, and laces. */
function spiralFrame(heading: number, roll: number): Cells {
  const key = heading * SPIRAL_ROLLS + roll;
  const hit = spiralCells.get(key);
  if (hit) return hit;
  const a = (heading / SPIRAL_HEADINGS) * Math.PI - Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Between an ellipse and a lens, so the ends come to points.
  const half = (u: number) => SPIRAL_WIDE * Math.max(0, 1 - (u / SPIRAL_LONG) ** 2) ** 0.6;
  const body = new Map<string, { u: number; v: number }>();
  for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
    const u = i * c + j * s;
    const v = j * c - i * s;
    if (Math.abs(u) < SPIRAL_LONG && Math.abs(v) <= half(u)) body.set(`${i},${j}`, { u, v });
  }
  const phi = (roll / SPIRAL_ROLLS) * Math.PI * 2;
  const laceV = (half(0) - 1) * Math.sin(phi);
  const out: Cells = [];
  for (const [k, p] of body) {
    const [i, j] = k.split(',').map(Number);
    const edge = !body.has(`${i + 1},${j}`) || !body.has(`${i - 1},${j}`) || !body.has(`${i},${j + 1}`) || !body.has(`${i},${j - 1}`);
    let ink = '#9c5a24';
    if (edge) ink = '#17181c';
    else if (Math.cos(phi) > 0.2 && Math.abs(p.u) <= SPIRAL_LACE && Math.abs(p.v - laceV) < 0.5) ink = '#ffffff';
    else if (i * 0.45 + j * 0.9 > 0.9) ink = '#723f18';
    out.push({ i, j, ink });
  }
  spiralCells.set(key, out);
  return out;
}

/** Where each canvas last drew the ball, and which way it was flying. */
const flightTrack = new WeakMap<CanvasRenderingContext2D, { x: number; y: number; a: number }>();

/**
 * Which way the ball is moving on screen, from its last two positions. Positions leave the
 * camera out, so a panning camera doesn't tilt the ball.
 */
function flightHeading(ctx: CanvasRenderingContext2D, f: Frame): number {
  const x = f.bx * PX;
  const y = (f.by - f.bz) * PY;
  const last = flightTrack.get(ctx);
  if (!last) { flightTrack.set(ctx, { x, y, a: 0 }); return 0; }
  const dx = x - last.x;
  const dy = y - last.y;
  const d = Math.hypot(dx, dy);
  // A tiny step is a pause or a second draw this frame, and a huge one is a cut.
  if (d < 0.25) return last.a;
  if (d < 60) last.a = Math.atan2(dy, dx);
  last.x = x; last.y = y;
  return last.a;
}

/** The pass flies nose first along its path, spinning about its long axis. */
function drawSpiral(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number): void {
  let h = Math.round(((angle + Math.PI / 2) / Math.PI) * SPIRAL_HEADINGS) % SPIRAL_HEADINGS;
  if (h < 0) h += SPIRAL_HEADINGS;
  const roll = Math.floor(tick / SPIRAL_TICKS) % SPIRAL_ROLLS;
  // The center sits on a cell's middle, so every cell lands on the art grid.
  const cx = Math.round((x - U / 2) / U) * U + U / 2;
  const cy = Math.round((y - U / 2) / U) * U + U / 2;
  for (const cell of spiralFrame(h, roll)) {
    ctx.fillStyle = cell.ink;
    ctx.fillRect(cx - U / 2 + cell.i * U, cy - U / 2 + cell.j * U, U, U);
  }
}

/** The ball when nobody has it. */
function drawLooseBall(ctx: CanvasRenderingContext2D, f: Frame, cam: number): void {
  const bx = screenX(f.bx, cam);
  const by = screenY(f.by) - f.bz * PY;
  const angle = flightHeading(ctx, f);
  if (f.phase === 'flight' && f.bz > 0.3) drawSpiral(ctx, bx, by, angle, f.tick);
  else drawBall(ctx, bx, by, f.tick, f.bz > 0.3);
}

/**
 * A deep ball can climb behind the scoreboard, so the session draws it again after the HUD.
 * Drawing it twice in a frame doesn't change its heading.
 */
export function drawBallOverHud(ctx: CanvasRenderingContext2D, f: Frame, cam: number): void {
  if ((f.carrier < 0 || f.phase === 'dead') && f.bz > 0.3) drawLooseBall(ctx, f, cam);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#17181c';
  ctx.fillRect(x - 6, y - 2, 12, 4);
  ctx.fillRect(x - 2, y - 6, 4, 12);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x - 4, y, 8, 2);
  ctx.fillRect(x, y - 4, 2, 8);
  ctx.fillRect(x - 2, y - 2, 6, 6);
}

function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, 8, 3, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** The lines drawn before the snap: pass routes in yellow, the back's run or fake in orange. */
export function routeLines(s: SimState): SceneInfo['routes'] {
  return s.players.filter((p) => p.route && (p.job === 'route' || p.job === 'mesh')).map((p) => ({ i: p.i, pts: p.route!, color: p.job === 'mesh' ? '#ff7a1e' : undefined }));
}

function drawRoute(ctx: CanvasRenderingContext2D, f: Frame, r: SceneInfo['routes'][number], cam: number): void {
  const X = (x: number) => screenX(x, cam);
  const startX = X(f.px[r.i]);
  const startY = screenY(f.py[r.i]);
  ctx.strokeStyle = r.color ?? '#ffe94a';
  ctx.lineWidth = 2;
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
  ctx.fillStyle = '#3f8cff';
  ctx.fillRect(Math.round(X(info.desc.los) / 2) * 2, Y(0), 4, fieldH);
  if (info.firstDownX !== null) {
    const fx = Math.round(X(info.firstDownX) / 2) * 2;
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(fx, Y(0), 4, fieldH);
    ctx.fillStyle = '#ff7a1e';
    ctx.fillRect(fx, Y(0) - 12, 4, 12);
    ctx.fillRect(fx - 4, Y(0) - 16, 12, 6);
  }
  // Route lines, before the snap and while the QB holds the ball.
  if (f.phase === 'pre' || f.phase === 'pocket') for (const r of info.routes) drawRoute(ctx, f, r, cam);

  // The ball's trail through the air.
  for (let i = 0; i < opts.trail.length; i++) {
    const p = opts.trail[i];
    ctx.fillStyle = `rgba(255,255,255,${(0.08 + (0.32 * i) / opts.trail.length).toFixed(2)})`;
    ctx.fillRect(Math.round(X(p.x) / 2) * 2, Math.round((Y(p.y) - p.z * PY) / 2) * 2, 2, 2);
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
    drawShadow(ctx, sx, sy);
    ATLAS.get(REF_KIT, 1).draw(ctx, 'ref', r.pose, Math.floor(opts.now / 300), sx, sy, r.face, FIG);
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
    drawShadow(ctx, sx, sy);
    const face = f.face[i] < 0 ? -1 : 1;
    atlas.draw(ctx, build, pose, frame, sx, sy, face, FIG);
    if (f.carrier === i && f.phase !== 'dead') {
      const cell = composedCells()[cellIndex(build, pose, frame)];
      drawBall(ctx, sx + face * (cell.hand[0] - CELL_W / 2) * FIG, sy + (cell.hand[1] - (CELL_H - 1)) * FIG, f.tick, false);
    }
    // Markers keep their size, just above a figure about 24 pixels tall.
    if (opts.starMarkers && info.stars[i]) drawStar(ctx, sx, sy - 30);
    if (opts.nameTags && info.names[i] && (f.carrier === i || info.routes.some((r) => r.i === i)) && (f.phase === 'pre' || f.phase === 'pocket' || f.carrier === i)) {
      const tag = info.names[i].toUpperCase().slice(0, 12);
      const tw = textWidth(tag);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx + 9, sy - 18, tw + 4, 10);
      drawText(ctx, tag, sx + 11, sy - 17, '#fff');
    }
    if (f.carrier === i && f.meter > 0 && f.phase !== 'dead') {
      // The truck meter.
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - 12, sy - 32, 24, 6);
      ctx.fillStyle = '#ff7a1e';
      ctx.fillRect(sx - 10, sy - 30, Math.round(10 * Math.min(1, f.meter)) * 2, 2);
    }
  }
  drawRef();
  if (opts.helped) {
    const h = opts.helped;
    const sx = X(h.x);
    const sy = Y(h.y);
    const atlas = ATLAS.get(info.kits[h.seat], h.skin);
    atlas.draw(ctx, 'std', 'run', Math.floor(h.tick / 16), sx + 11 * FIG, sy, 1, FIG);
    atlas.draw(ctx, 'std', 'helped', Math.floor(h.tick / 16), sx, sy, 1, FIG);
  }
  // The ball, when nobody has it.
  if (f.carrier < 0 || f.phase === 'dead') {
    const bx = X(f.bx);
    const by = Y(f.by);
    if (f.bz > 0.1) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.round(bx) - 2, Math.round(by), 4, 2); }
    drawLooseBall(ctx, f, cam);
  } else flightTrack.delete(ctx);
  // Aim cursor.
  if (f.aimOn && f.phase === 'pocket') {
    const qx = X(f.px[0]);
    const qy = Y(f.py[0]);
    const tx = qx + f.ax * PX;
    const ty = qy + f.ay * PY;
    ctx.globalAlpha = Math.max(0.05, info.aimAlpha);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(qx, qy - 8); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(tx / 2) * 2, Math.round(ty / 2) * 2, 2, 2);
    ctx.globalAlpha = 1;
  }
}
