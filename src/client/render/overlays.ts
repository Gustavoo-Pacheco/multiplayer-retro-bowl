// Weather, banners, meters and scoreboards drawn over the field.
import type { Weather } from '../../shared/data/config';
import { TEAM_BY_ID } from '../../shared/data/teams';
import type { BannerKind, MatchState } from '../../shared/rules/match';
import { T } from '../../shared/sim/tuning';
import type { Frame } from '../../shared/protocol';
import { lum, shade } from '../art/palette';
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
      ctx.fillRect(Math.round(x), Math.round(y), 1, 5);
    }
  } else if (w === 'snow') {
    ctx.fillStyle = 'rgba(235,242,250,.08)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 90; i++) {
      const x = ((i * 71.9 + Math.sin(t * 0.8 + i) * 14 - t * 10) % W + W) % W;
      const y = ((i * 41.3 + t * (34 + (i % 5) * 7)) % H + H) % H;
      const s = i % 4 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    for (let i = 0; i < 16; i++) {
      const x = ((i * 137.7 + t * (260 + (i % 4) * 50)) % (W + 60) + W + 60) % (W + 60) - 30;
      const y = 22 + ((i * 61.3) % (H - 40));
      ctx.fillRect(Math.round(x), Math.round(y + Math.sin(t * 2 + i) * 3), 16 + (i % 3) * 9, 1);
    }
    // A windsock over the stands shows the direction.
    const flap = Math.round(Math.sin(t * 7) * 1.5);
    ctx.fillStyle = '#d6d6cf'; ctx.fillRect(W - 40, 16, 2, 16);
    ctx.fillStyle = '#ff8a1e'; ctx.fillRect(W - 38, 17 + flap, 14, 3);
    ctx.fillStyle = '#f4f4ee'; ctx.fillRect(W - 24, 18 + flap, 8, 2);
  }
}

const BANNER_COLOURS: Record<BannerKind, string> = { quarter: '#18222d', half: '#18222d', twoMin: '#7a2a1e', overtime: '#3b2a6b', touchdown: '#18222d', score: '#18222d' };

/** A band across the screen with big text, in the scoring team's colours where there is one. */
export function drawBanner(ctx: CanvasRenderingContext2D, text: string, kind: BannerKind, sub: string, team: string | null, age: number): void {
  const t = team ? TEAM_BY_ID[team] : null;
  const bg = t ? t.primary : BANNER_COLOURS[kind];
  const edge = t ? t.secondary : '#ffd23f';
  const big = kind === 'touchdown' ? 5 : 3;
  const h = big * 7 + (sub ? 34 : 22);
  const open = Math.min(1, age / 180);
  const y = Math.round(150 - h / 2);
  const reach = Math.round((W / 2) * open);
  ctx.fillStyle = shade(bg, 0.8);
  ctx.fillRect(W / 2 - reach, y - 3, reach * 2, h + 6);
  ctx.fillStyle = bg;
  ctx.fillRect(W / 2 - reach, y, reach * 2, h);
  ctx.fillStyle = edge;
  ctx.fillRect(W / 2 - reach, y, reach * 2, 2);
  ctx.fillRect(W / 2 - reach, y + h - 2, reach * 2, 2);
  if (open < 1) return;
  const fg = lum(bg) > 0.62 ? '#14181c' : '#fff';
  drawTextCentered(ctx, text, W / 2 + big, y + 11 + big, shade(bg, 0.55), big);
  drawTextCentered(ctx, text, W / 2, y + 11, fg, big);
  if (sub) drawTextCentered(ctx, sub, W / 2, y + h - 13, fg);
}

export function drawKickMeter(ctx: CanvasRenderingContext2D, f: Frame): void {
  const K = T.kick;
  const x = 590;
  const top = 90;
  const h = 170;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 3, top - 14, 22, h + 17);
  ctx.fillStyle = '#44525e';
  ctx.fillRect(x, top, 16, h);
  ctx.fillStyle = '#58d68d';
  ctx.fillRect(x, top + h * (1 - K.greenHi), 16, h * (K.greenHi - K.greenLo));
  drawText(ctx, 'PWR', x, top - 11, '#fff');
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x - 3, Math.round(top + h * (1 - f.ax)) - 1, 22, 3);
  if (f.phase === 'kickAim') {
    // The arrow swings across the middle, which points at the goal.
    const cx = W / 2;
    const y = 300;
    const w = 130;
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - w - 4, y - 4, w * 2 + 8, 16);
    ctx.fillStyle = '#44525e';
    ctx.fillRect(cx - w, y, w * 2, 8);
    ctx.fillStyle = '#58d68d';
    ctx.fillRect(cx - 12, y, 24, 8);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(Math.round(cx + f.ay * w) - 2, y - 4, 4, 16);
  }
}

/** The halftime scoreboard. */
export function drawScoreboard(ctx: CanvasRenderingContext2D, m: MatchState): void {
  const w = 300;
  const x = (W - w) / 2;
  const y = 186;
  const rows: [string, number[], number][] = [
    [m.teams[0], m.scoreByPeriod[0], m.score[0]],
    [m.teams[1], m.scoreByPeriod[1], m.score[1]],
  ];
  ctx.fillStyle = 'rgba(0,0,0,.85)';
  ctx.fillRect(x, y, w, 58);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + 57, w, 1);
  const col = (i: number) => x + 80 + i * 34;
  const n = Math.max(2, rows[0][1].length);
  for (let i = 0; i < n; i++) drawText(ctx, i >= 4 ? 'OT' : `Q${i + 1}`, col(i), y + 8, '#9db0bf');
  drawText(ctx, 'T', x + w - 28, y + 8, '#ffd23f');
  rows.forEach(([id, by, total], r) => {
    const ry = y + 24 + r * 15;
    ctx.fillStyle = TEAM_BY_ID[id].primary;
    ctx.fillRect(x + 12, ry - 1, 8, 9);
    drawText(ctx, id, x + 26, ry, '#fff');
    for (let i = 0; i < n; i++) drawText(ctx, String(by[i] ?? 0), col(i), ry, '#cfd8df');
    const s = String(total);
    drawText(ctx, s, x + w - 22 - textWidth(s), ry, '#ffd23f');
  });
}
