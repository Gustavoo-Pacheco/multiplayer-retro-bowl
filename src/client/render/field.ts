// Draws the stadium and field once into an offscreen canvas, then blits the visible part.
import type { Team } from '../../shared/data/teams';
import type { Weather } from '../../shared/data/config';
import { T } from '../../shared/sim/tuning';
import { lum, shade, SKINS } from '../art/palette';
import { drawText, textWidth } from './font';
import { FIELD_TOP, H, PX, W } from './view';

const MARGIN_YARDS = 6;

export interface FieldOpts { left: Team; right: Team; home: Team; visitor: Team; weather: Weather; seed: number }
export interface FieldArt { canvas: HTMLCanvasElement; offsetX: number }

/** A small seeded generator, so the same stadium draws the same crowd on both screens. */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const SKY: Record<Weather, string> = { clear: '#79b4e4', rain: '#4b5563', snow: '#a9b6c3', wind: '#8db0ca' };

function drawStands(g: CanvasRenderingContext2D, w: number, o: FieldOpts, rand: () => number): void {
  const standsH = T.view.standsH;
  const indoor = o.weather === 'clear' && o.seed % 3 === 0;
  g.fillStyle = indoor ? '#20262d' : SKY[o.weather];
  g.fillRect(0, 0, w, 20);
  if (indoor) {
    // A roof truss for an indoor stadium.
    g.fillStyle = '#3b444e';
    for (let x = 0; x < w; x += 24) { g.fillRect(x, 3, 2, 15); g.fillRect(x, 3, 24, 2); g.fillRect(x, 16, 24, 2); }
    g.fillStyle = '#f7efc0';
    for (let x = 36; x < w; x += 96) g.fillRect(x, 6, 8, 3);
  } else if (o.weather === 'clear') {
    g.fillStyle = '#e8f3fb';
    for (let x = 30; x < w; x += 170) { g.fillRect(x, 15, 34, 3); g.fillRect(x + 8, 12, 18, 3); }
  }
  const crowd = [o.home.primary, o.home.primary, o.home.secondary, o.visitor.primary, '#c7c7bf', '#59636e', '#8c5a3c', '#2e3b52'];
  for (let row = 0; row < 7; row++) {
    const y = 19 + row * 6;
    g.fillStyle = row % 2 ? '#29343f' : '#2f3b47';
    g.fillRect(0, y, w, 6);
    for (let x = (row % 2) * 2; x < w; x += 4) {
      if (rand() < 0.1) continue;
      g.fillStyle = crowd[Math.floor(rand() * crowd.length)];
      g.fillRect(x, y + 2, 3, 3);
      g.fillStyle = SKINS[Math.floor(rand() * SKINS.length)];
      g.fillRect(x + 1, y, 2, 2);
    }
  }
  // Advertising band and walkway. The only name on it is the game's own.
  g.fillStyle = '#6b7380';
  g.fillRect(0, standsH, w, T.view.walkH);
  g.fillStyle = shade(o.home.primary, 0.85);
  g.fillRect(0, standsH + 1, w, T.view.walkH - 2);
  for (let x = 40; x < w; x += 220) drawText(g, 'BORG BOWL', x, standsH + 1, lum(o.home.primary) > 0.6 ? '#14181c' : '#f4f4ee');
}

function drawSidelineStrip(g: CanvasRenderingContext2D, X: (x: number) => number, y: number, rand: () => number): void {
  const h = T.view.stripH;
  g.fillStyle = '#2f6a36';
  g.fillRect(0, y, g.canvas.width, h);
  for (let x = 12; x < T.field.len - 8; x += 16) {
    const px = X(x + rand() * 4);
    const kind = Math.floor(x / 16) % 3;
    if (kind === 0) {
      // A bench.
      g.fillStyle = '#4a3a2a'; g.fillRect(px, y + 5, 44, 3);
      g.fillStyle = '#2c231a'; g.fillRect(px + 2, y + 8, 2, 3); g.fillRect(px + 40, y + 8, 2, 3);
    } else if (kind === 1) {
      // Equipment crates.
      g.fillStyle = '#c8701f'; g.fillRect(px, y + 3, 9, 8);
      g.fillStyle = '#8c4d14'; g.fillRect(px, y + 6, 9, 1);
      g.fillStyle = '#3f6fa3'; g.fillRect(px + 11, y + 5, 7, 6);
    } else {
      // A camera on a tripod.
      g.fillStyle = '#1c1f24'; g.fillRect(px + 2, y + 1, 8, 5);
      g.fillStyle = '#5d666e'; g.fillRect(px + 9, y + 2, 3, 2); g.fillRect(px + 5, y + 6, 2, 5); g.fillRect(px + 2, y + 10, 8, 1);
    }
  }
}

function drawGoalPost(g: CanvasRenderingContext2D, x: number, fieldMid: number): void {
  const bar = 40;
  const spread = 18;
  const up = 74;
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(x - 3, fieldMid, 8, 3);
  const dark = '#b8951c';
  const main = '#f0cb32';
  g.fillStyle = dark; g.fillRect(x, fieldMid - bar, 3, bar);
  g.fillStyle = main; g.fillRect(x, fieldMid - bar, 1, bar);
  // The crossbar runs away from the camera, so it reads as a short vertical on screen.
  g.fillStyle = main; g.fillRect(x, fieldMid - bar - spread, 2, spread * 2);
  // The far upright, then the near one.
  g.fillStyle = dark; g.fillRect(x, fieldMid - bar - spread - up, 2, up);
  g.fillStyle = main; g.fillRect(x, fieldMid - bar + spread - up, 2, up);
}

export function buildField(o: FieldOpts): FieldArt {
  const c = document.createElement('canvas');
  const total = T.field.len + MARGIN_YARDS * 2;
  c.width = Math.ceil(total * PX);
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => Math.round((x + MARGIN_YARDS) * PX);
  const rand = lcg(o.seed + 7);
  const top = FIELD_TOP;
  const fh = T.view.fieldH;
  const bot = top + fh;

  drawStands(g, c.width, o, rand);
  drawSidelineStrip(g, X, T.view.standsH + T.view.walkH, rand);
  // The grass past the field's lower edge.
  g.fillStyle = '#2f6a36';
  g.fillRect(0, bot, c.width, H - bot);
  g.fillStyle = '#28602f';
  for (let x = 0; x < c.width; x += 40) g.fillRect(x, bot + 8, 20, H - bot - 8);

  // Grass bands every 5 yards. Snow and rain darken or pale them.
  const light = o.weather === 'snow' ? '#cfdcd4' : o.weather === 'rain' ? '#35733b' : '#3f8a44';
  const dark = o.weather === 'snow' ? '#c1d0c7' : o.weather === 'rain' ? '#2f6a35' : '#378039';
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
      g.fillRect(px, py, 6 + rand() * 22, 2 + rand() * 6);
    }
  } else if (o.weather === 'snow') {
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 260; i++) g.fillRect(X(rand() * 120), top + rand() * fh, 3 + rand() * 18, 1 + rand() * 4);
  }

  const lineCol = o.weather === 'snow' ? '#7d97a6' : '#f4f4ee';
  // End zones, in the colours of the team defending them, with the nickname across them.
  const endZone = (x0: number, t: Team, rot: number) => {
    const ax = X(x0);
    const aw = X(x0 + 10) - ax;
    g.fillStyle = t.primary;
    g.fillRect(ax, top, aw, fh);
    g.save();
    g.beginPath(); g.rect(ax, top, aw, fh); g.clip();
    g.fillStyle = shade(t.primary, 0.84);
    for (let k = -fh; k < aw; k += 26) {
      g.beginPath(); g.moveTo(ax + k, top); g.lineTo(ax + k + 12, top); g.lineTo(ax + k + 12 + fh, bot); g.lineTo(ax + k + fh, bot); g.closePath(); g.fill();
    }
    g.restore();
    const name = t.nick.toUpperCase();
    const scale = Math.min(6, Math.floor((fh * 0.86) / (6 * name.length)));
    const textW = textWidth(name, scale);
    g.save();
    g.translate(ax + aw / 2, top + fh / 2);
    g.rotate(rot);
    drawText(g, name, -textW / 2 + scale, (-7 * scale) / 2 + scale, shade(t.primary, 0.55), scale);
    drawText(g, name, -textW / 2, (-7 * scale) / 2, lum(t.primary) > 0.62 ? '#14181c' : '#f4f4ee', scale);
    g.restore();
  };
  endZone(0, o.left, -Math.PI / 2);
  endZone(110, o.right, Math.PI / 2);

  // Yard lines, with a thicker goal line.
  g.fillStyle = lineCol;
  for (let x = 10; x <= 110; x += 5) {
    const goal = x === 10 || x === 110;
    g.fillRect(X(x) - (goal ? 1 : 0), top, goal ? 3 : 1, fh);
  }
  // Hash marks: two rows near the middle, plus ticks along each sideline.
  const rowA = top + fh * 0.408;
  const rowB = top + fh * 0.585;
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    const px = X(x);
    g.fillRect(px, rowA, 1, 3);
    g.fillRect(px, rowB, 1, 3);
    g.fillRect(px, top + 2, 1, 3);
    g.fillRect(px, bot - 5, 1, 3);
  }
  // Yard numbers every 10 yards. The upper row is upside down, and an arrow points to the nearer goal.
  const number = (cx: number, cy: number, n: number, flip: boolean) => {
    const digits = String(n);
    g.save();
    g.translate(cx, cy);
    if (flip) g.rotate(Math.PI);
    drawText(g, digits[0], -18, -10, lineCol, 3);
    drawText(g, digits[1], 4, -10, lineCol, 3);
    g.restore();
  };
  const arrow = (cx: number, cy: number, dir: number) => {
    g.fillStyle = lineCol;
    g.beginPath();
    g.moveTo(cx + dir * 26, cy);
    g.lineTo(cx + dir * 21, cy - 4);
    g.lineTo(cx + dir * 21, cy + 4);
    g.closePath();
    g.fill();
  };
  for (let x = 20; x <= 100; x += 10) {
    const n = x <= 60 ? x - 10 : 110 - x;
    const px = X(x);
    for (const [cy, flip] of [[top + fh * 0.17, true], [top + fh * 0.83, false]] as const) {
      number(px, cy, n, flip);
      if (n !== 50) arrow(px, cy, x < 60 ? -1 : 1);
    }
  }
  // The home team's letters at midfield.
  const midText = o.home.id;
  const mid = X(60);
  g.fillStyle = shade(o.home.primary, 0.9);
  g.fillRect(mid - 40, top + fh / 2 - 22, 80, 44);
  g.fillStyle = o.home.secondary;
  g.fillRect(mid - 40, top + fh / 2 - 22, 80, 3);
  g.fillRect(mid - 40, top + fh / 2 + 19, 80, 3);
  drawText(g, midText, mid - textWidth(midText, 4) / 2, top + fh / 2 - 14, lum(o.home.primary) > 0.62 ? '#14181c' : '#f4f4ee', 4);
  // Sideline border.
  g.fillStyle = lineCol;
  g.fillRect(X(0) - 1, top - 2, X(120) - X(0) + 3, 3);
  g.fillRect(X(0) - 1, bot - 1, X(120) - X(0) + 3, 3);
  g.fillRect(X(0) - 1, top, 3, fh);
  g.fillRect(X(120) - 1, top, 3, fh);
  // Goalposts at the back of each end zone.
  drawGoalPost(g, X(0), top + fh / 2);
  drawGoalPost(g, X(120), top + fh / 2);
  return { canvas: c, offsetX: MARGIN_YARDS * PX };
}

export function drawField(ctx: CanvasRenderingContext2D, art: FieldArt, cam: number): void {
  ctx.drawImage(art.canvas, Math.round(W / 2 - cam * PX - art.offsetX), 0);
}
