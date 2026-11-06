// Chalkboard-style play diagrams for the playbook cards, drawn pixel by pixel so they match the game's chunky art.
// The offense always attacks to the right, as on the field when going that way, so the formation's right is at the bottom.
import { DEF_CALLS, FORMATIONS, OL_SPOTS, PLAYBOOK, ROUTES, type DefCall, type Formation, type Play, type Spot } from '../../shared/data/playbook';

const GRASS = '#3a8f35';
const GRASS_DARK = '#33802f';
const LINE = 'rgba(255,255,255,.28)';
const LOS = '#3f8cff';
const ROUTE = '#ffe94a';
const RUN = '#ff7a1e';
const BLOCK = '#f4f4ee';
const OFF = '#f4f4ee';
const OFF_DIM = 'rgba(244,244,238,.45)';
const DEF = '#ff5a4a';
const DEEP = 'rgba(63,140,255,.5)';
const UNDER = 'rgba(255,210,63,.42)';
const INK = '#14181c';

/** Depth shown on a card: from behind the backfield to deep downfield, in yards. */
const BACK = 7;
const DEEP_SHOWN = 23;
const HALF_W = 8.6;

class Pix {
  ctx: CanvasRenderingContext2D;
  constructor(public w: number, public h: number) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.ctx = c.getContext('2d')!;
  }
  /** Field yards to art pixels. */
  X(f: number): number { return Math.round(((f + BACK) / (BACK + DEEP_SHOWN)) * (this.w - 1)); }
  Y(l: number): number { return Math.round(((l + HALF_W) / (2 * HALF_W)) * (this.h - 1)); }
  dot(x: number, y: number, c: string): void { this.ctx.fillStyle = c; this.ctx.fillRect(x, y, 1, 1); }
  rect(x: number, y: number, w: number, h: number, c: string): void { this.ctx.fillStyle = c; this.ctx.fillRect(x, y, w, h); }
  /** A one-pixel line with no smoothing. A dash of n draws n, skips n. */
  line(x0: number, y0: number, x1: number, y1: number, c: string, dash = 0): void {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let n = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (!dash || Math.floor(n / dash) % 2 === 0) this.dot(x, y, c);
      n += 1;
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  arrow(px: number, py: number, x: number, y: number, c: string): void {
    const a = Math.atan2(y - py, x - px);
    for (const da of [2.5, -2.5]) this.line(x, y, Math.round(x + Math.cos(a + da) * 2.2), Math.round(y + Math.sin(a + da) * 2.2), c);
  }
  /** A filled ellipse, tested pixel by pixel so the edge stays hard. */
  oval(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const k = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (k <= 1) this.dot(x, y, c);
      }
    }
  }
  url(): string { return this.ctx.canvas.toDataURL(); }
}

function field(p: Pix): void {
  p.rect(0, 0, p.w, p.h, GRASS);
  for (let f = -5; f <= DEEP_SHOWN; f += 5) {
    const x = p.X(f);
    if (Math.floor(f / 5) % 2 === 0) p.rect(x, 0, Math.max(1, p.X(f + 5) - x), p.h, GRASS_DARK);
  }
  for (let f = -5; f <= DEEP_SHOWN; f += 5) for (let y = 0; y < p.h; y += 2) p.dot(p.X(f), y, LINE);
  p.rect(p.X(0), 0, 1, p.h, LOS);
}

/** An offensive player: a small ring, as on a chalkboard. */
function ring(p: Pix, x: number, y: number, c: string): void {
  p.dot(x, y - 1, c); p.dot(x - 1, y, c); p.dot(x + 1, y, c); p.dot(x, y + 1, c);
  p.dot(x - 1, y - 1, INK); p.dot(x + 1, y + 1, INK); p.dot(x + 1, y - 1, INK); p.dot(x - 1, y + 1, INK);
}

/** A defender: a small X. */
function cross(p: Pix, x: number, y: number, c: string): void {
  for (const d of [-1, 0, 1]) { p.dot(x + d, y + d, c); p.dot(x + d, y - d, c); }
}

function path(p: Pix, pts: Spot[], c: string, dash = 0, head = true): void {
  for (let i = 1; i < pts.length; i++) p.line(p.X(pts[i - 1][0]), p.Y(pts[i - 1][1]), p.X(pts[i][0]), p.Y(pts[i][1]), c, dash);
  const n = pts.length;
  if (head && n >= 2) p.arrow(p.X(pts[n - 2][0]), p.Y(pts[n - 2][1]), p.X(pts[n - 1][0]), p.Y(pts[n - 1][1]), c);
}

/** A block: a short stroke ahead of the player with a cap across it. */
function block(p: Pix, f: number, l: number, toward: Spot = [f + 1.6, l]): void {
  const x0 = p.X(f);
  const y0 = p.Y(l);
  const x1 = p.X(toward[0]);
  const y1 = p.Y(toward[1]);
  p.line(x0 + 1, y0, x1, y1, BLOCK);
  const vertical = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  if (vertical) p.line(x1, y1 - 1, x1, y1 + 1, BLOCK); else p.line(x1 - 1, y1, x1 + 1, y1, BLOCK);
}

const sideOf = (l: number, fallback: 1 | -1): 1 | -1 => (l > 0.2 ? 1 : l < -0.2 ? -1 : fallback);

function routePts(start: Spot, name: keyof typeof ROUTES, side: 1 | -1): Spot[] {
  const pts: Spot[] = [start];
  for (const [f, o] of ROUTES[name].pts) {
    const ff = Math.min(DEEP_SHOWN - 0.5, start[0] + f);
    pts.push([ff, Math.max(-HALF_W + 0.4, Math.min(HALF_W - 0.4, start[1] + side * o))]);
  }
  return pts;
}

function drawOffense(p: Pix, play: Play): void {
  const f: Formation = FORMATIONS[play.formation];
  const run = play.run;
  const hole = run?.hole ?? 0;
  const skill: [Spot, Play['wr1'], 1 | -1][] = [[f.wr1, play.wr1, -1], [f.wr2, play.wr2, 1], [f.te, play.te, play.teSide]];
  for (const [spot, a, fb] of skill) {
    const side = sideOf(spot[1], fb);
    if (a === 'block') block(p, spot[0], spot[1]);
    else if (a === 'stalk') block(p, spot[0], spot[1], [spot[0] + 3, spot[1]]);
    else if (a === 'lead') path(p, [spot, [-1, hole * 0.8], [1.5, hole]], BLOCK, 0, false);
    else {
      const pts = routePts(spot, a, side);
      path(p, pts, ROUTE, 0, !ROUTES[a].stop);
      if (ROUTES[a].stop) { const e = pts[pts.length - 1]; p.line(p.X(e[0]), p.Y(e[1]) - 1, p.X(e[0]), p.Y(e[1]) + 1, ROUTE); }
    }
  }
  // Linemen: drive blocks on runs, pass sets otherwise, and a pull for power and counter.
  OL_SPOTS.forEach((s, i) => {
    const pull = run?.pull && play.kind === 'run' && i === (hole > 0 ? 0 : 2);
    if (pull) path(p, [s, [-1.8, s[1] * 0.6], [-1.3, hole * 0.7], [1.2, hole]], BLOCK, 1, false);
    else if (play.kind === 'screen' && play.rb === 'screen') path(p, [s, [0.5 + i * 0.5, 2.4 + i * 1.4]], BLOCK, 1, false);
    else if (play.kind === 'run' || play.kind === 'sneak') block(p, s[0], s[1], [s[0] + 1.6, s[1]]);
    else block(p, s[0], s[1], [s[0] - 1.2, s[1]]);
  });
  // The back: his run, his fake, his route or his block.
  const rb = f.rb;
  if (run && play.kind === 'run') {
    const pts: Spot[] = [rb];
    if (run.fake !== undefined) pts.push([rb[0] + 0.6, run.fake]);
    pts.push([f.gun ? f.qb[0] + 0.2 : -2.6, 0.7 * sideOf(f.gun ? rb[1] : hole, play.rbSide)], [-1.2, hole * 0.8], [1, hole], [4, hole * 1.03]);
    path(p, pts, RUN);
  } else if (run && play.kind === 'pa') {
    path(p, [rb, [-2.6, 0.7 * sideOf(hole, play.rbSide)], [-0.5, hole * 0.9]], RUN, 1, false);
  } else if (play.kind === 'sneak') {
    path(p, [f.qb, [3, 0]], RUN);
  } else if (play.rb === 'block') {
    block(p, rb[0], rb[1], [rb[0] + 1.2, rb[1]]);
  } else if (play.rb !== 'stalk' && play.rb !== 'lead') {
    const pts = routePts(rb, play.rb, sideOf(rb[1], play.rbSide));
    path(p, pts, ROUTE, 0, !ROUTES[play.rb].stop);
  }
  // Players last, over their lines.
  for (const s of [f.qb, f.rb, f.wr1, f.wr2, f.te, ...OL_SPOTS]) ring(p, p.X(s[0]), p.Y(s[1]), OFF);
}

/** A neutral formation behind the defense diagrams, so each call reads against something. */
const BASE: Spot[] = (() => { const f = FORMATIONS.single; return [f.qb, f.rb, f.wr1, f.wr2, f.te, ...OL_SPOTS]; })();

function drawDefense(p: Pix, call: DefCall): void {
  const dl: Spot[] = [[1, -1.8], [1, 0], [1, 1.8]];
  const spots: Spot[] = [];
  call.jobs.forEach((j, n) => {
    if (n < 3) { spots.push(dl[n]); return; }
    const side = n === 3 || n === 5 ? -1 : 1;
    if (j.k === 'man') { const t = BASE[j.on]; spots.push([n >= 5 && n <= 6 ? (call.press ? 1.4 : 6.5) : n === 7 ? 5.5 : 4, t[1] + (t[1] > 0 ? -0.5 : t[1] < 0 ? 0.5 : 0)]); }
    else if (j.k === 'rush') spots.push([3, side * 2.2]);
    else if (j.k === 'crash') spots.push([3.5, side * 1.6]);
    else if (j.k === 'deep') spots.push([10, 0]);
    else spots.push([n >= 5 && n <= 6 ? 7 : n === 7 ? Math.min(12, j.z.at[0]) : Math.min(5, j.z.at[0]), n === 3 || n === 4 ? j.z.at[1] * 0.75 : j.z.at[1]]);
  });
  // Zones underneath the players.
  call.jobs.forEach((j) => {
    if (j.k !== 'zone') return;
    const z = j.z;
    const d1 = Math.min(z.d1, z.deep ? DEEP_SHOWN : z.d0 + 9);
    const cx = (p.X(z.d0) + p.X(d1)) / 2;
    const rx = Math.max(2, (p.X(d1) - p.X(z.d0)) / 2);
    const ry = Math.max(2, (p.Y(z.hw) - p.Y(-z.hw)) / 2 - 0.5);
    p.oval(cx, p.Y(z.at[1]), rx, ry, z.deep ? DEEP : UNDER);
  });
  for (const s of BASE) ring(p, p.X(s[0]), p.Y(s[1]), OFF_DIM);
  call.jobs.forEach((j, n) => {
    const s = spots[n];
    const x = p.X(s[0]);
    const y = p.Y(s[1]);
    if (j.k === 'rush') { p.line(x - 1, y, p.X(-3.5), Math.round((y + p.Y(0)) / 2), DEF); p.arrow(x, y, p.X(-3.5), Math.round((y + p.Y(0)) / 2), DEF); }
    else if (j.k === 'crash') { p.line(x - 1, y, p.X(-4), p.Y(0), DEF); p.arrow(x, y, p.X(-4), p.Y(0), DEF); }
    else if (j.k === 'man') { const t = BASE[j.on]; p.line(x - 1, y, p.X(t[0]) + 1, p.Y(t[1]), BLOCK, 1); }
    else if (j.k === 'deep') { p.line(x + 1, y, p.X(16), y, '#a8c0ff'); p.arrow(x, y, p.X(16), y, '#a8c0ff'); }
  });
  for (const s of spots) cross(p, p.X(s[0]), p.Y(s[1]), DEF);
}

const cache = new Map<string, string>();

/** A play's diagram as an image URL, at w x h art pixels. */
export function playArt(id: number, w: number, h: number): string {
  const key = `o:${id}:${w}x${h}`;
  let url = cache.get(key);
  if (!url) {
    const p = new Pix(w, h);
    field(p);
    drawOffense(p, PLAYBOOK[id] ?? PLAYBOOK[0]);
    url = p.url();
    cache.set(key, url);
  }
  return url;
}

export function defenseArt(id: number, w: number, h: number): string {
  const key = `d:${id}:${w}x${h}`;
  let url = cache.get(key);
  if (!url) {
    const p = new Pix(w, h);
    field(p);
    drawDefense(p, DEF_CALLS[id] ?? DEF_CALLS[0]);
    url = p.url();
    cache.set(key, url);
  }
  return url;
}
