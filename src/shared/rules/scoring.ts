import { otOnScore } from './overtime';
import type { Seat } from '../sim/state';
import type { MatchState } from './match';

export const POINTS = { td: 6, fg: 3, safety: 2, xp: 1, two: 2 } as const;

export function addPoints(m: MatchState, team: Seat, pts: number): void {
  m.score[team] += pts;
  const i = m.period - 1;
  while (m.scoreByPeriod[team].length <= i) m.scoreByPeriod[team].push(0);
  m.scoreByPeriod[team][i] += pts;
}

export function scoreTouchdown(m: MatchState, team: Seat): void {
  addPoints(m, team, POINTS.td);
  otOnScore(m, team, 'td');
}

export function scoreFieldGoal(m: MatchState, team: Seat): void {
  addPoints(m, team, POINTS.fg);
  otOnScore(m, team, 'fg');
}

export function scoreSafety(m: MatchState, team: Seat): void {
  addPoints(m, team, POINTS.safety);
  otOnScore(m, team, 'safety');
}
