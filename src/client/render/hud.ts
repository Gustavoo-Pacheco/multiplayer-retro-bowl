// The score strip across the top of the screen.
import { TEAM_BY_ID } from '../../shared/data/teams';
import { ownYard } from '../../shared/rules/downs';
import type { MatchState } from '../../shared/rules/match';
import { drawText, textWidth } from './font';
import { W } from './view';

const STRIP_H = 14;

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
    ctx.fillStyle = i < used ? on : '#4a5560';
    ctx.fillRect(x + i * 5, y, 4, 7);
  }
  return x + total * 5;
}

export function drawHud(ctx: CanvasRenderingContext2D, m: MatchState, clock: number, playClock: number | null, me: number | null): void {
  ctx.fillStyle = 'rgba(0,0,0,.82)';
  ctx.fillRect(0, 0, W, STRIP_H);
  const y = 4;
  let x = 4;
  const seg = (t: string, color = '#fff', gap = 8) => { drawText(ctx, t, x, y, color); x += textWidth(t) + gap; };
  const a = TEAM_BY_ID[m.teams[0]];
  const b = TEAM_BY_ID[m.teams[1]];
  const pos = m.possession;
  if (pos === 0) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(x, y + 2, 3, 3); }
  x += 5;
  seg(`${a.id} ${m.score[0]}`, me === 0 ? '#fff4b0' : '#fff', 6);
  if (pos === 1) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(x, y + 2, 3, 3); }
  x += 5;
  seg(`${b.id} ${m.score[1]}`, me === 1 ? '#fff4b0' : '#fff', 12);
  seg(m.period > 4 ? 'OT' : `Q${m.period}`, '#9fd3ff', 4);
  seg(clockText(clock), '#fff', 12);
  if (m.phase === 'presnap' || m.phase === 'live' || m.phase === 'choice4th') {
    if (!m.play || m.play.type === 'scrimmage' || m.phase === 'choice4th') { seg(downText(m), '#fff', 10); seg(spotText(m), '#cfd8df', 10); }
    else seg(playTypeText(m), '#fff', 10);
  } else if (m.phase === 'conversion') seg('CONVERSION', '#fff', 10);
  if (playClock !== null) seg(`:${String(Math.ceil(playClock)).padStart(2, '0')}`, playClock <= 5 ? '#ff6b5b' : '#ffd23f', 10);
  // Right side: the pips belong to the team on offense.
  let rx = W - 94;
  drawText(ctx, 'TO', rx, y, '#9db0bf');
  rx = pips(ctx, rx + 13, y, m.timeouts[pos], Math.max(m.timeouts[pos], 3), '#ffd23f') + 4;
  drawText(ctx, 'AUD', rx, y, '#9db0bf');
  pips(ctx, rx + 19, y, Math.min(m.audibles[pos], 3), 3, '#58d68d');
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
