import { DEFAULT_CONFIG, type MatchConfig } from '../../src/shared/data/config';
import { afterCoinToss, applyChoice, createMatch, type MatchState } from '../../src/shared/rules/match';
import { emptyStats, type PlayEnd, type PlayResult, type Seat } from '../../src/shared/sim/state';

export function match(over: Partial<MatchConfig> = {}, seed = 3): MatchState {
  return createMatch({ ...DEFAULT_CONFIG, ...over }, ['SEA', 'LAR'], seed);
}

/** A match in play, past the opening kick, with seat 0 on offense at its own 40 and 1st & 10. */
export function inPlay(over: Partial<MatchConfig> = {}, patch: Partial<MatchState> = {}): MatchState {
  let m = afterCoinToss(match(over));
  if (m.phase === 'kickChoice') m = applyChoice(m, 'deep');
  m = {
    ...m, possession: 0, attack: [1, -1], ballX: 50, down: 1, toGo: 10, phase: 'presnap', chosen4th: false, ...patch,
    play: { id: 7, type: 'scrimmage', seed: 1, offense: patch.possession ?? 0, dir: 1, los: patch.ballX ?? 50, down: patch.down ?? 1, toGo: patch.toGo ?? 10, playbook: 1, clock: patch.clock ?? m.clock },
    playId: 7,
  };
  return m;
}

export function result(m: MatchState, end: PlayEnd, spotX: number, over: Partial<PlayResult> = {}): PlayResult {
  const off = m.play?.offense ?? m.possession;
  return {
    playId: m.play?.id ?? m.playId, type: m.play?.type ?? 'scrimmage', end, spotX, possessor: off as Seat, offense: off as Seat, clock: m.clock, ezImpetus: false,
    lastCarrier: off as Seat, sack: false, stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, yards: 0, big: false, ...over,
  };
}
