// The score display at the top of the screen.
import { TEAM_BY_ID } from '../../shared/data/teams';
import { ownYard } from '../../shared/rules/downs';
import type { MatchState } from '../../shared/rules/match';
import { lum } from '../art/palette';
import { drawText, textWidth } from './font';
import { W } from './view';

export function clockText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function downText(m: MatchState): string {
  const n = ['', '1ST', '2ND', '3RD', '4TH'][m.down] ?? '';
  const dir = m.attack[m.possession];
  const toGoal = dir > 0 ? 110 - m.ballX : m.ballX - 10;
  const go = m.toGo >= toGoal - 0.01 ? 'GOAL' : String(Math.max(1, Math.round(m.toGo)));
  return `${n} & ${go}`;
}

export function spotText(m: MatchState): string {
  const y = Math.round(ownYard(m.ballX, m.attack[m.possession]));
  if (y === 50) return 'MID 50';
  return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
}

function pips(ctx: CanvasRenderingContext2D, x: number, y: number, used: number, total: number, on: string): number {
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < used ? on : '#39445e';
    ctx.fillRect(x + i * 6, y, 4, 8);
  }
  return x + total * 6;
}

/** A team's block: its colour with its letters, plus a ball when it has possession. */
function teamBlock(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number, hasBall: boolean, mine: boolean): void {
  const t = TEAM_BY_ID[id];
  ctx.fillStyle = t.primary;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = mine ? '#ffffff' : t.secondary;
  ctx.fillRect(x, y + h - 4, w, 4);
  const ink = lum(t.primary) > 0.62 ? '#14181c' : '#ffffff';
  drawText(ctx, id, x + 6, y + 3, ink, 2);
  if (hasBall) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + w - 16, y + 4, 12, 10);
    ctx.fillStyle = '#c47a2c';
    ctx.fillRect(x + w - 14, y + 6, 8, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w - 12, y + 8, 4, 2);
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, m: MatchState, clock: number, playClock: number | null, me: number | null): void {
  const teamW = 70;
  const scoreW = 38;
  const midW = 96;
  const rowH = 22;
  const total = teamW * 2 + scoreW * 2 + midW;
  const x0 = (W - total) / 2;
  const y0 = 4;
  // The second row only appears when it has something to say, so banners and replays get a tidy block.
  let line = '';
  if (m.phase === 'presnap' || m.phase === 'live' || m.phase === 'choice4th') {
    line = !m.play || m.play.type === 'scrimmage' || m.phase === 'choice4th' ? `${downText(m)}  ${spotText(m)}` : playTypeText(m);
  } else if (m.phase === 'conversion') line = 'CONVERSION';
  const second = !!line || playClock !== null;
  ctx.fillStyle = '#000';
  ctx.fillRect(x0 - 4, 0, total + 8, y0 + rowH + (second ? 22 : 4));
  const pos = m.possession;
  teamBlock(ctx, m.teams[0], x0, y0, teamW, rowH, pos === 0, me === 0);
  teamBlock(ctx, m.teams[1], x0 + total - teamW, y0, teamW, rowH, pos === 1, me === 1);
  // The scores.
  const scoreAt = (n: number, x: number) => {
    const t = String(n);
    drawText(ctx, t, x + (scoreW - textWidth(t, 2)) / 2, y0 + 4, '#ffd23f', 2);
  };
  scoreAt(m.score[0], x0 + teamW);
  scoreAt(m.score[1], x0 + total - teamW - scoreW);
  // The quarter and clock on a white plate.
  const mx = x0 + teamW + scoreW;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(mx, y0, midW, rowH);
  const q = m.period > 4 ? 'OT' : `Q${m.period}`;
  drawText(ctx, q, mx + 4, y0 + 4, '#c0261c', 1);
  const ct = clockText(clock);
  drawText(ctx, ct, mx + midW - textWidth(ct, 2) - 4, y0 + 4, '#14181c', 2);
  // The second row: what's happening now, the play clock, and the offense's timeouts and audibles.
  if (!second) return;
  const y1 = y0 + rowH + 4;
  if (line) drawText(ctx, line, x0, y1, '#ffffff', 2);
  if (playClock !== null) {
    const pc = `:${String(Math.ceil(playClock)).padStart(2, '0')}`;
    drawText(ctx, pc, x0 + total - textWidth(pc, 2), y1, playClock <= 5 ? '#ff5a4a' : '#ffd23f', 2);
  }
  // Below the block, in the corner, so a long down-and-distance can't run into them.
  const py = y0 + rowH + 22 + 4;
  ctx.fillStyle = '#000';
  ctx.fillRect(x0 - 4, py - 4, 88, 18);
  drawText(ctx, 'TO', x0, py, '#a8c0ff');
  const after = pips(ctx, x0 + 16, py, m.timeouts[pos], Math.max(m.timeouts[pos], 3), '#ffd23f');
  drawText(ctx, 'AU', after + 4, py, '#a8c0ff');
  pips(ctx, after + 20, py, Math.min(m.audibles[pos], 3), 3, '#4ee07a');
}

function playTypeText(m: MatchState): string {
  switch (m.play?.type) {
    case 'kickoff': return 'KICKOFF';
    case 'freeKick': return 'FREE KICK';
    case 'onside': return 'ONSIDE KICK';
    case 'punt': return 'PUNT';
    case 'fieldGoal': return 'FIELD GOAL';
    case 'extraPoint': return 'EXTRA POINT';
    case 'twoPoint': return 'TWO-POINT TRY';
    default: return '';
  }
}
