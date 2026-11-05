// Weather, banners, meters and scoreboards drawn over the field.
import type { Weather } from '../../shared/data/config';
import { TEAM_BY_ID } from '../../shared/data/teams';
import type { BannerKind, MatchState } from '../../shared/rules/match';
import { T } from '../../shared/sim/tuning';
import type { Frame } from '../../shared/protocol';
import { lum } from '../art/palette';
import { drawText, drawTextCentered, textWidth } from './font';
import { H, W } from './view';

// Rain, snow and a wind cue, drawn from a fixed set of particles moved by time, so they cost nothing to keep.
export function drawWeather(ctx: CanvasRenderingContext2D, w: Weather, nowMs: number): void {
  if (w === 'clear') return;
  const t = nowMs / 1000;
  if (w === 'rain') {
    ctx.fillStyle = 'rgba(30,40,60,.12)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(190,210,235,.55)';
    for (let i = 0; i < 90; i++) {
      const x = ((i * 53.3 - t * 90 * (1 + (i % 3) * 0.2)) % W + W) % W;
      const y = ((i * 97.1 + t * 420 * (1 + (i % 3) * 0.2)) % H + H) % H;
      ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 2, 6);
    }
  } else if (w === 'snow') {
    ctx.fillStyle = 'rgba(235,242,250,.08)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 90; i++) {
      const x = ((i * 71.9 + Math.sin(t * 0.8 + i) * 14 - t * 10) % W + W) % W;
      const y = ((i * 41.3 + t * (34 + (i % 5) * 7)) % H + H) % H;
      const s = i % 4 === 0 ? 4 : 2;
      ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, s, s);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    for (let i = 0; i < 16; i++) {
      const x = ((i * 137.7 + t * (260 + (i % 4) * 50)) % (W + 60) + W + 60) % (W + 60) - 30;
      const y = 22 + ((i * 61.3) % (H - 40));
      ctx.fillRect(Math.round(x / 2) * 2, Math.round((y + Math.sin(t * 2 + i) * 3) / 2) * 2, 16 + (i % 3) * 8, 2);
    }
    // A windsock over the stands shows the direction.
    const flap = Math.round(Math.sin(t * 7) * 1.5);
    ctx.fillStyle = '#d6d6cf'; ctx.fillRect(W - 40, 16, 2, 16);
    ctx.fillStyle = '#ff8a1e'; ctx.fillRect(W - 38, 17 + flap, 14, 3);
    ctx.fillStyle = '#f4f4ee'; ctx.fillRect(W - 24, 18 + flap, 8, 2);
  }
}

const BANNER_COLOURS: Record<BannerKind, string> = { quarter: '#1c2f8c', half: '#1c2f8c', twoMin: '#b8321f', overtime: '#5a2aa8', touchdown: '#1c2f8c', score: '#1c2f8c' };

/** A solid band across the screen with huge text, in the scoring team's colours where there is one. */
export function drawBanner(ctx: CanvasRenderingContext2D, text: string, kind: BannerKind, sub: string, team: string | null, age: number): void {
  const t = team ? TEAM_BY_ID[team] : null;
  const bg = t ? t.primary : BANNER_COLOURS[kind];
  const edge = t && lum(t.secondary) > 0.2 ? t.secondary : '#ffffff';
  const fits = (n: number) => textWidth(text, n) <= W - 40;
  const big = kind === 'touchdown' ? (fits(8) ? 8 : 6) : fits(6) ? 6 : 4;
  const h = big * 7 + (sub ? 46 : 28);
  const open = Math.min(1, age / 180);
  const y = Math.round((150 - h / 2) / 2) * 2;
  const reach = Math.round((W / 2) * open / 2) * 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(W / 2 - reach, y - 6, reach * 2, h + 12);
  ctx.fillStyle = edge;
  ctx.fillRect(W / 2 - reach, y - 4, reach * 2, h + 8);
  ctx.fillStyle = bg;
  ctx.fillRect(W / 2 - reach, y, reach * 2, h);
  if (open < 1) return;
  const fg = lum(bg) > 0.62 ? '#14181c' : '#fff';
  const drop = big >= 6 ? 4 : 2;
  drawTextCentered(ctx, text, W / 2 + drop, y + 14 + drop, lum(bg) > 0.62 ? '#ffffff' : '#000', big);
  drawTextCentered(ctx, text, W / 2, y + 14, fg, big);
  if (sub) drawTextCentered(ctx, sub, W / 2, y + h - 22, fg, 2);
}

export function drawKickMeter(ctx: CanvasRenderingContext2D, f: Frame): void {
  const K = T.kick;
  const x = 584;
  const top = 90;
  const h = 170;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 8, top - 26, 40, h + 34);
  drawTextCentered(ctx, 'PWR', x + 12, top - 21, '#fff', 2);
  ctx.fillStyle = '#39445e';
  ctx.fillRect(x, top, 24, h);
  ctx.fillStyle = '#4ee07a';
  ctx.fillRect(x, top + h * (1 - K.greenHi), 24, h * (K.greenHi - K.greenLo));
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x - 6, Math.round((top + h * (1 - f.ax)) / 2) * 2 - 2, 36, 4);
  if (f.phase === 'kickAim') {
    // The arrow swings across the middle, which points at the goal.
    const cx = W / 2;
    const y = 296;
    const w = 130;
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - w - 4, y - 4, w * 2 + 8, 20);
    ctx.fillStyle = '#39445e';
    ctx.fillRect(cx - w, y, w * 2, 12);
    ctx.fillStyle = '#4ee07a';
    ctx.fillRect(cx - 12, y, 24, 12);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(Math.round((cx + f.ay * w) / 2) * 2 - 2, y - 4, 4, 20);
  }
}

/** The halftime scoreboard. */
export function drawScoreboard(ctx: CanvasRenderingContext2D, m: MatchState): void {
  const w = 388;
  const x = (W - w) / 2;
  const y = 204;
  const rows: [string, number[], number][] = [
    [m.teams[0], m.scoreByPeriod[0], m.score[0]],
    [m.teams[1], m.scoreByPeriod[1], m.score[1]],
  ];
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 6, y - 6, w + 12, 96);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 4, y - 4, w + 8, 92);
  ctx.fillStyle = '#1c2f8c';
  ctx.fillRect(x, y, w, 84);
  const col = (i: number) => x + 110 + i * 54;
  const n = Math.max(2, rows[0][1].length);
  for (let i = 0; i < n; i++) drawText(ctx, i >= 4 ? 'OT' : `Q${i + 1}`, col(i), y + 8, '#a8c0ff', 2);
  drawText(ctx, 'T', x + w - 26, y + 8, '#ffd23f', 2);
  rows.forEach(([id, by, total], r) => {
    const ry = y + 32 + r * 24;
    const t = TEAM_BY_ID[id];
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 8, ry - 4, 88, 22);
    ctx.fillStyle = t.primary;
    ctx.fillRect(x + 10, ry - 2, 84, 18);
    drawText(ctx, id, x + 16, ry, lum(t.primary) > 0.62 ? '#14181c' : '#fff', 2);
    for (let i = 0; i < n; i++) drawText(ctx, String(by[i] ?? 0), col(i), ry, '#ffffff', 2);
    const s = String(total);
    drawText(ctx, s, x + w - 14 - textWidth(s, 2), ry, '#ffd23f', 2);
  });
}
