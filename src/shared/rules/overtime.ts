// Overtime endings. Standard: a touchdown or safety wins, a field goal gives the other team one drive.
import type { Seat } from '../sim/state';
import type { MatchState } from './match';

export interface OtState { mode: 'standard' | 'sudden'; first: Seat; stage: 'first' | 'answer' | 'sudden' }

export function otOnScore(m: MatchState, scorer: Seat, kind: 'td' | 'fg' | 'safety'): void {
  const ot = m.ot;
  if (!ot) return;
  if (ot.mode === 'sudden' || ot.stage === 'sudden') { m.winner = scorer; return; }
  if (kind === 'td' || kind === 'safety') { m.winner = scorer; return; }
  // A field goal.
  if (ot.stage === 'first') { ot.stage = 'answer'; return; }
  ot.stage = 'sudden'; // the answering team tied it: next score wins
}

/** The ball changed hands with no score. */
export function otOnDriveEnd(m: MatchState): void {
  const ot = m.ot;
  if (!ot || ot.mode === 'sudden') return;
  if (ot.stage === 'first') ot.stage = 'sudden';
  else if (ot.stage === 'answer') m.winner = ot.first; // a failed answer loses
}
