// Field position helpers and the first-down logic.
import { T } from '../sim/tuning';
import type { Seat } from '../sim/state';
import type { MatchState } from './match';

export function ownYard(x: number, dir: number): number { return dir > 0 ? x - 10 : 110 - x; }
export function xFromOwn(own: number, dir: number): number { return dir > 0 ? 10 + own : 110 - own; }
export function yardsToGoal(x: number, dir: number): number { return dir > 0 ? 110 - x : x - 10; }

/** The ball is always spotted between the 1-yard lines. */
export function clampSpot(x: number): number { return Math.max(11, Math.min(109, x)); }

export function setFirstDown(m: MatchState, team: Seat, x: number): void {
  const spot = clampSpot(x);
  m.possession = team;
  m.ballX = spot;
  m.down = 1;
  m.toGo = Math.min(T.rules.firstDownYards, yardsToGoal(spot, m.attack[team]));
  m.chosen4th = false;
}

export function setTouchback(m: MatchState, team: Seat): void {
  setFirstDown(m, team, xFromOwn(T.rules.touchback, m.attack[team]));
}

/** Moves the chains after a play by the offense. Returns true if downs ran out. */
export function advanceDowns(m: MatchState, team: Seat, spotX: number): boolean {
  const dir = m.attack[team];
  const spot = clampSpot(spotX);
  const gained = (spot - m.ballX) * dir;
  if (gained >= m.toGo - 1e-6) { setFirstDown(m, team, spot); return false; }
  if (m.down >= 4) { setFirstDown(m, (1 - team) as Seat, spot); return true; }
  m.toGo = m.toGo - gained;
  m.ballX = spot;
  m.down += 1;
  m.chosen4th = false;
  return false;
}
