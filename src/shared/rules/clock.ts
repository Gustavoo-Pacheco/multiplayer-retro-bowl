// The clock model: real seconds in live play, fixed runoff between plays.
import { T } from '../sim/tuning';
import type { MatchState } from './match';

export function quarterSeconds(m: MatchState): number { return m.config.quarter * 60; }
export function runoffSeconds(m: MatchState): number { return T.clock.runoff[m.config.quarter] ?? 12; }
export function twoMinuteMark(m: MatchState): number { return T.clock.twoMinute[m.config.quarter] ?? 120; }

export function timeoutsPerHalf(m: MatchState): number {
  const c = m.config.timeouts;
  return c === 'auto' ? T.clock.autoTimeouts[m.config.quarter] ?? 2 : c;
}

/** Called at a dead ball. Applies a pending runoff check: nothing may snap if the runoff would hit 0:00. */
export function settleRunoff(m: MatchState, clockRunning: boolean): void {
  m.runoffPending = false;
  if (!clockRunning || m.clock <= 0) return;
  const run = runoffSeconds(m);
  if (m.clock - run <= 0) { m.clock = 0; return; }
  m.runoffPending = true;
}

/** Stops the clock once per half. Returns true when the warning fires. */
export function checkTwoMinute(m: MatchState): boolean {
  if (!m.config.twoMinute || m.twoMinUsed) return false;
  if (m.period !== 2 && m.period !== 4) return false;
  const mark = twoMinuteMark(m);
  const after = m.runoffPending ? m.clock - runoffSeconds(m) : m.clock;
  if (after > mark) return false;
  m.twoMinUsed = true;
  if (m.clock > mark) m.clock = mark;
  m.runoffPending = false;
  return true;
}
