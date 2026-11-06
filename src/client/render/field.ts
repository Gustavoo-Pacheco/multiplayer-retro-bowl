// Draws the stadium and field once into an offscreen canvas, then blits the visible part.
import type { Team } from '../../shared/data/teams';
import type { Weather } from '../../shared/data/config';
import { T } from '../../shared/sim/tuning';
import { lum, shade, SKINS } from '../art/palette';
import { drawText, textWidth } from './font';
import { FIELD_TOP, H, PX, W } from './view';

const MARGIN_YARDS = 6;

export interface FieldOpts { left: Team; right: Team; home: Team; visitor: Team; weather: Weather; seed: number; midfield?: boolean }
export interface FieldArt { canvas: HTMLCanvasElement; offsetX: number }

/** A small seeded generator, so the same stadium draws the same crowd on both screens. */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const SKY: Record<Weather, string> = { clear: '#58b4f4', rain: '#56607a', snow: '#b4c4d4', wind: '#7cc0e8' };
const even = (v: number): number => Math.round(v / 2) * 2;
const CROWD_ROWS = 4;

function drawStands(g: CanvasRenderingContext2D, w: number, o: FieldOpts, rand: () => number): void {
  const standsH = T.view.standsH;
  // The sky takes whatever the crowd leaves.
  const sky = Math.max(8, standsH - CROWD_ROWS * 8);
  const indoor = o.weather === 'clear' && o.seed % 3 === 0;
  g.fillStyle = indoor ? '#20262d' : SKY[o.weather];
  g.fillRect(0, 0, w, sky);
  if (indoor) {
    // A roof truss for an indoor stadium.
    g.fillStyle = '#3b444e';
    for (let x = 0; x < w; x += 24) { g.fillRect(x, 2, 2, sky - 4); g.fillRect(x, 2, 24, 2); g.fillRect(x, sky - 4, 24, 2); }
    g.fillStyle = '#f7efc0';
    for (let x = 36; x < w; x += 96) g.fillRect(x, even(sky / 2) - 2, 8, 3);
  } else if (o.weather === 'clear') {
    g.fillStyle = '#e8f3fb';
    for (let x = 30; x < w; x += 170) { g.fillRect(x, sky - 5, 34, 3); g.fillRect(x + 8, sky - 8, 18, 3); }
  }
  // The crowd: blocks of colour with a head on top, on two-tone steps.
  const crowd = [o.home.primary, o.home.primary, o.home.primary, o.home.secondary, o.visitor.primary, '#f4f4ee', '#ffd23f', '#e8483c'];
  for (let row = 0; row < CROWD_ROWS; row++) {
    const y = sky + row * 8;
    g.fillStyle = row % 2 ? '#1c2548' : '#242f5c';
    g.fillRect(0, y, w, 8);
    for (let x = (row % 2) * 4; x < w; x += 8) {
      if (rand() < 0.08) continue;
      g.fillStyle = crowd[Math.floor(rand() * crowd.length)];
      g.fillRect(x, y + 4, 6, 4);
      g.fillStyle = SKINS[Math.floor(rand() * SKINS.length)];
      g.fillRect(x + 2, y + 2, 2, 2);
    }
  }
  // Advertising band. The only name on it is the game's own.
  g.fillStyle = '#10163a';
  g.fillRect(0, standsH, w, T.view.walkH);
  for (let x = 40; x < w; x += 220) drawText(g, 'BORG BOWL', x, standsH + 1, '#ffd23f');
}

function drawSidelineStrip(g: CanvasRenderingContext2D, X: (x: number) => number, y: number, rand: () => number, weather: Weather): void {
  const h = T.view.stripH;
  g.fillStyle = weather === 'snow' ? '#c3d2ca' : '#3a8f35';
  g.fillRect(0, y, g.canvas.width, h);
  for (let x = 12; x < T.field.len - 8; x += 16) {
    const px = even(X(x + rand() * 4));
    const kind = Math.floor(x / 16) % 3;
    if (kind === 0) {
      // A bench.
      g.fillStyle = '#7a4a22'; g.fillRect(px, y + 4, 44, 4);
      g.fillStyle = '#3a2412'; g.fillRect(px + 2, y + 8, 2, 4); g.fillRect(px + 40, y + 8, 2, 4);
    } else if (kind === 1) {
      // Equipment crates.
      g.fillStyle = '#e8862a'; g.fillRect(px, y + 2, 10, 10);
      g.fillStyle = '#a85a14'; g.fillRect(px, y + 6, 10, 2);
      g.fillStyle = '#3f7fd8'; g.fillRect(px + 12, y + 4, 8, 8);
    } else {
      // A camera on a tripod.
      g.fillStyle = '#1c1f24'; g.fillRect(px + 2, y, 8, 6);
      g.fillStyle = '#5d666e'; g.fillRect(px + 10, y + 2, 2, 2); g.fillRect(px + 4, y + 6, 2, 6); g.fillRect(px + 2, y + 10, 6, 2);
    }
  }
}

function drawGoalPost(g: CanvasRenderingContext2D, x: number, fieldMid: number): void {
  const bar = 40;
  const spread = 18;
  const up = 74;
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(x - 4, fieldMid, 12, 4);
  const dark = '#c89a10';
  const main = '#ffd630';
  g.fillStyle = dark; g.fillRect(x, fieldMid - bar, 4, bar);
  g.fillStyle = main; g.fillRect(x, fieldMid - bar, 2, bar);
  // The crossbar runs away from the camera, so it reads as a short vertical on screen.
  g.fillStyle = main; g.fillRect(x, fieldMid - bar - spread, 4, spread * 2);
  // The far upright, then the near one.
  g.fillStyle = dark; g.fillRect(x, fieldMid - bar - spread - up, 4, up);
  g.fillStyle = main; g.fillRect(x, fieldMid - bar + spread - up, 4, up);
}

export function buildField(o: FieldOpts): FieldArt {
  const c = document.createElement('canvas');
  const total = T.field.len + MARGIN_YARDS * 2;
  c.width = Math.ceil(total * PX);
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => even((x + MARGIN_YARDS) * PX);
  const rand = lcg(o.seed + 7);
  const top = FIELD_TOP;
  const fh = T.view.fieldH;
  const bot = top + fh;

  drawStands(g, c.width, o, rand);
  drawSidelineStrip(g, X, T.view.standsH + T.view.walkH, rand, o.weather);
  // The grass past the field's lower edge.
  g.fillStyle = o.weather === 'snow' ? '#c3d2ca' : '#3a8f35';
  g.fillRect(0, bot, c.width, H - bot);

  // Grass bands every 5 yards. Snow and rain darken or pale them.
  const light = o.weather === 'snow' ? '#dbe6df' : o.weather === 'rain' ? '#3f8a42' : '#52b548';
  const dark = o.weather === 'snow' ? '#ccd9d1' : o.weather === 'rain' ? '#387e3c' : '#47a63e';
  g.fillStyle = light;
  g.fillRect(0, top, c.width, fh);
  for (let x = -5; x < T.field.len + 5; x += 5) {
    g.fillStyle = Math.round(x / 5) % 2 === 0 ? light : dark;
    g.fillRect(X(x), top, X(x + 5) - X(x), fh);
  }
  // Worn patches: mud in the rain, bare ground in the wind.
  if (o.weather === 'rain' || o.weather === 'wind') {
    g.fillStyle = o.weather === 'rain' ? 'rgba(84,62,38,.42)' : 'rgba(120,110,60,.18)';
    for (let i = 0; i < 90; i++) {
      const px = X(10 + rand() * 100);
      const py = top + fh * (0.3 + rand() * 0.4);
      g.fillRect(even(px), even(py), even(6 + rand() * 22), even(2 + rand() * 6));
    }
  } else if (o.weather === 'snow') {
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 260; i++) g.fillRect(X(rand() * 120), even(top + rand() * fh), even(4 + rand() * 18), even(2 + rand() * 4));
  }

  const lineCol = o.weather === 'snow' ? '#6f8ba0' : '#ffffff';
  // End zones, in the colours of the team defending them, with the nickname across them.
  const endZone = (x0: number, t: Team, rot: number) => {
    const ax = X(x0);
    const aw = X(x0 + 10) - ax;
    g.fillStyle = t.primary;
    g.fillRect(ax, top, aw, fh);
    const name = t.nick.toUpperCase();
    const scale = Math.min(8, Math.floor((fh * 0.9) / (7 * name.length)));
    const textW = textWidth(name, scale);
    g.save();
    g.translate(ax + aw / 2, top + fh / 2);
    g.rotate(rot);
    drawText(g, name, -textW / 2 + 4, (-7 * scale) / 2 + 4, shade(t.primary, 0.5), scale);
    drawText(g, name, -textW / 2, (-7 * scale) / 2, lum(t.primary) > 0.62 ? '#14181c' : '#f4f4ee', scale);
    g.restore();
  };
  endZone(0, o.left, -Math.PI / 2);
  endZone(110, o.right, Math.PI / 2);

  // Yard lines, with a thicker goal line.
  g.fillStyle = lineCol;
  for (let x = 10; x <= 110; x += 5) {
    const goal = x === 10 || x === 110;
    g.fillRect(X(x) - (goal ? 2 : 0), top, goal ? 6 : 2, fh);
  }
  // Hash marks: two rows near the middle, plus ticks along each sideline.
  const rowA = even(top + fh * 0.408);
  const rowB = even(top + fh * 0.585);
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    const px = X(x);
    g.fillRect(px, rowA, 2, 4);
    g.fillRect(px, rowB, 2, 4);
    g.fillRect(px, top + 4, 2, 4);
    g.fillRect(px, bot - 8, 2, 4);
  }
  // Yard numbers every 10 yards. The upper row is upside down, and an arrow points to the nearer goal.
  const number = (cx: number, cy: number, n: number, flip: boolean) => {
    const digits = String(n);
    g.save();
    g.translate(cx, cy);
    if (flip) g.rotate(Math.PI);
    drawText(g, digits[0], -28, -14, lineCol, 4);
    drawText(g, digits[1], 4, -14, lineCol, 4);
    g.restore();
  };
  const arrow = (cx: number, cy: number, dir: number) => {
    g.fillStyle = lineCol;
    const tip = cx + dir * 40;
    for (let k = 0; k < 3; k++) g.fillRect(tip - dir * k * 2 - (dir > 0 ? 2 : 0), even(cy) - k * 2 - 2, 2, 4 + k * 4);
  };
  for (let x = 20; x <= 100; x += 10) {
    const n = x <= 60 ? x - 10 : 110 - x;
    const px = X(x);
    for (const [cy, flip] of [[even(top + fh * 0.17), true], [even(top + fh * 0.83), false]] as const) {
      number(px, cy, n, flip);
      if (n !== 50) arrow(px, cy, x < 60 ? -1 : 1);
    }
  }
  // The home team's letters at midfield. The title screen leaves them out, because its panel sits there.
  if (o.midfield !== false) {
    const midText = o.home.id;
    const mid = X(60);
    const my = even(top + fh / 2);
    g.fillStyle = '#ffffff';
    g.fillRect(mid - 48, my - 28, 96, 56);
    g.fillStyle = o.home.primary;
    g.fillRect(mid - 44, my - 24, 88, 48);
    g.fillStyle = o.home.secondary;
    g.fillRect(mid - 44, my + 18, 88, 6);
    drawText(g, midText, even(mid - textWidth(midText, 4) / 2), my - 16, lum(o.home.primary) > 0.62 ? '#14181c' : '#ffffff', 4);
  }
  // Sideline border.
  g.fillStyle = lineCol;
  g.fillRect(X(0) - 2, top - 4, X(120) - X(0) + 6, 4);
  g.fillRect(X(0) - 2, bot, X(120) - X(0) + 6, 4);
  g.fillRect(X(0) - 2, top, 4, fh);
  g.fillRect(X(120), top, 4, fh);
  // Goalposts at the back of each end zone.
  drawGoalPost(g, X(0), top + fh / 2);
  drawGoalPost(g, X(120), top + fh / 2);
  return { canvas: c, offsetX: MARGIN_YARDS * PX };
}

export function drawField(ctx: CanvasRenderingContext2D, art: FieldArt, cam: number): void {
  ctx.drawImage(art.canvas, even(W / 2 - cam * PX - art.offsetX), 0);
}
