// Draws a pose into a grid of palette letters. Pure, so it can be tested without a browser.
import { BUILDS, PROPS, type Build, type BuildName, type Grid } from './parts';
import { POSES, type Limb, type Pose } from './poses';

// Every art pixel is drawn as a 2 x 2 block, for a chunky look. These are screen pixels.
export const ART_SCALE = 2;
// A figure is about 20 x 32, and the cell leaves room for an outstretched arm, a leg or a jump.
export const CELL_W = 48;
export const CELL_H = 42;
const ART_W = CELL_W / ART_SCALE;
const ART_H = CELL_H / ART_SCALE;

export interface Cell { rows: string[]; hand: readonly [number, number]; clipped: number }

const SHADE: Record<string, string> = { J: 'j', P: 'p', S: 's', T: 't', W: 'w', C: 'c', K: 'K', N: 'N', H: 'h' };

class Canvas {
  // A working area bigger than the cell, so nothing gets lost before the figure is centred.
  static W = 64;
  static H = 64;
  px = new Array<string>(Canvas.W * Canvas.H).fill('.');
  set(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= Canvas.W || y >= Canvas.H || c === '.') return;
    this.px[y * Canvas.W + x] = c;
  }
  stamp(x: number, y: number, size: number, c: string): void {
    const o = Math.floor((size - 1) / 2);
    for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) this.set(x - o + a, y - o + b, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, size: number, c: string): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.stamp(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), size, c);
  }
  grid(g: Grid, x: number, y: number, shear = 0): void {
    g.forEach((row, r) => {
      const dx = g.length > 1 ? Math.round((shear * (g.length - 1 - r)) / (g.length - 1)) : 0;
      for (let c = 0; c < row.length; c++) this.set(x + c + dx, y + r, row[c]);
    });
  }
}

function leg(cv: Canvas, hx: number, hy: number, l: Limb, b: Build, back: boolean): void {
  const c = (x: string) => (back ? SHADE[x] ?? x : x);
  cv.line(hx, hy, hx + l[0], hy + l[1], b.legW, c(b.thigh));
  cv.line(hx + l[0], hy + l[1], hx + l[2], hy + l[3], b.legW, c(b.shin));
  // The shoe fills the leg's last row and points forward, in the direction the sprite faces.
  const fx = hx + l[2] - Math.floor((b.legW - 1) / 2);
  const fy = hy + l[3] + 1;
  for (let i = 0; i <= b.legW; i++) cv.set(fx + i, fy, b.shoe === 'W' ? c('W') : 'K');
}

function arm(cv: Canvas, sx: number, sy: number, l: Limb, b: Build, back: boolean): readonly [number, number] {
  const c = (x: string) => (back ? SHADE[x] ?? x : x);
  cv.line(sx, sy, sx + l[0], sy + l[1], b.armW, c(b.sleeve));
  cv.line(sx + l[0], sy + l[1], sx + l[2], sy + l[3], 1, c(b.fore));
  return [sx + l[2], sy + l[3]];
}

/** Turns the working area a quarter clockwise, so a head at the top ends up leading to the right. */
function rotate(cv: Canvas): Canvas {
  const o = new Canvas();
  for (let y = 0; y < Canvas.H; y++) for (let x = 0; x < Canvas.W; x++) {
    const v = cv.px[y * Canvas.W + x];
    if (v !== '.') o.set(Canvas.H - 1 - y, x, v);
  }
  return o;
}

/** Poses are written in screen pixels. The art grid is half that size. */
const half = (v: number): number => Math.sign(v) * Math.round(Math.abs(v) / ART_SCALE);
const halfLimb = (l: Limb): Limb => [half(l[0]), half(l[1]), half(l[2]), half(l[3])];

export function composePose(full: Pose, buildName: BuildName): Cell {
  const b = BUILDS[buildName];
  const p: Pose = {
    ...full, lean: half(full.lean ?? 0), air: half(full.air ?? 0),
    legF: halfLimb(full.legF), legB: halfLimb(full.legB), armF: halfLimb(full.armF), armB: halfLimb(full.armB),
    head: full.head ? [half(full.head[0]), half(full.head[1])] : undefined,
  };
  let cv = new Canvas();
  const hipX = 28;
  const hipY = 40;
  const tw = b.torso[0].length;
  const th = b.torso.length;
  const lean = p.lean ?? 0;
  const sx = hipX + lean;
  const sy = hipY - th + 2;
  const backShoulder = -Math.floor(tw / 2) + 1;
  const frontShoulder = Math.floor(tw / 2) - 1;
  arm(cv, sx + backShoulder, sy, p.armB, b, true);
  leg(cv, hipX - 1, hipY, p.legB, b, true);
  cv.grid(b.torso, hipX - Math.floor(tw / 2), hipY - th + 1, lean);
  leg(cv, hipX + 1, hipY, p.legF, b, false);
  const hd = p.head ?? [0, 0];
  cv.grid(b.head, sx - 3 + hd[0], sy - b.head.length + hd[1], 0);
  let hand = arm(cv, sx + frontShoulder, sy, p.armF, b, false);
  if (p.prop) {
    const g = PROPS[p.prop];
    cv.grid(g, hand[0] - Math.floor(g[0].length / 2), hand[1] - Math.floor(g.length / 2));
    if (p.prop === 'pom') {
      const backHand = [sx + backShoulder + p.armB[2], sy + p.armB[3]];
      cv.grid(g, backHand[0] - 1, backHand[1] - 1);
    }
  }
  if (p.prone) {
    cv = rotate(cv);
    hand = [Canvas.H - 1 - hand[1], hand[0]];
  }
  // Centre it, and stand it on the ground.
  let minX = Canvas.W, maxX = 0, maxY = 0;
  for (let y = 0; y < Canvas.H; y++) for (let x = 0; x < Canvas.W; x++) {
    if (cv.px[y * Canvas.W + x] === '.') continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  // Standing figures centre on their hips, so a raised arm doesn't make them jump sideways. Lying ones centre on their body.
  const dx = p.prone ? Math.floor(ART_W / 2) - Math.round((minX + maxX) / 2) : Math.floor(ART_W / 2) - hipX;
  const dy = ART_H - 2 - (p.air ?? 0) - maxY;
  const out: string[][] = [];
  for (let r = 0; r < ART_H; r++) out.push(new Array<string>(ART_W).fill('.'));
  let clipped = 0;
  for (let y = 0; y < Canvas.H; y++) for (let x = 0; x < Canvas.W; x++) {
    const v = cv.px[y * Canvas.W + x];
    if (v === '.') continue;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ART_W || ny >= ART_H) { clipped += 1; continue; }
    out[ny][nx] = v;
  }
  // A dark outline keeps a player readable against any grass, snow or end zone, even in matching colours.
  const outlined = out.map((r) => [...r]);
  for (let y = 0; y < ART_H; y++) for (let x = 0; x < ART_W; x++) {
    if (out[y][x] !== '.') continue;
    const near = (out[y - 1]?.[x] ?? '.') !== '.' || (out[y + 1]?.[x] ?? '.') !== '.' || (out[y][x - 1] ?? '.') !== '.' || (out[y][x + 1] ?? '.') !== '.';
    if (near) outlined[y][x] = 'O';
  }
  // Double every art pixel, so the rest of the game can treat a cell as ordinary screen pixels.
  const rows: string[] = [];
  for (const r of outlined) {
    const wide = r.map((c) => c.repeat(ART_SCALE)).join('');
    for (let k = 0; k < ART_SCALE; k++) rows.push(wide);
  }
  return { rows, hand: [(hand[0] + dx) * ART_SCALE, (hand[1] + dy) * ART_SCALE], clipped };
}

export interface CellRef { build: BuildName; name: string; frame: number; index: number }

export const ALL_FRAMES = Object.keys(POSES);
const KIT_BUILDS: BuildName[] = ['std', 'big', 'slim'];
const ONLY: Partial<Record<BuildName, string[]>> = {
  ref: ['stance', 'refTd', 'refFirst', 'refIncomplete', 'refPenalty'],
  cheer: ['cheerIdle', 'cheer'],
  coach: ['coachIdle'],
  photo: ['photoIdle'],
};

/** Every drawing in an atlas, in a fixed order, so all the recoloured atlases share one layout. */
export const CELLS: CellRef[] = [];
const INDEX = new Map<string, number>();
const addCell = (build: BuildName, name: string): void => {
  POSES[name].forEach((_, frame) => {
    INDEX.set(`${build}:${name}:${frame}`, CELLS.length);
    CELLS.push({ build, name, frame, index: CELLS.length });
  });
};
for (const b of KIT_BUILDS) for (const name of ALL_FRAMES) addCell(b, name);
for (const [b, names] of Object.entries(ONLY)) for (const name of names) addCell(b as BuildName, name);

export function cellIndex(build: BuildName, name: string, frame: number): number {
  const n = POSES[name].length;
  return INDEX.get(`${build}:${name}:${((frame % n) + n) % n}`) ?? 0;
}

let composed: Cell[] | null = null;
export function composedCells(): Cell[] {
  if (!composed) composed = CELLS.map((c) => composePose(POSES[c.name][c.frame], c.build));
  return composed;
}
