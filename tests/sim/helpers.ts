import { DIFFICULTY } from '../../src/shared/data/config';
import { buildRoster } from '../../src/shared/data/roster';
import { createPlay } from '../../src/shared/sim/setup';
import type { PlayDesc, PlayType, Seat, SimCfg, SimState, SimTeams } from '../../src/shared/sim/state';

export function cfg(over: Partial<SimCfg> = {}): SimCfg {
  const d = DIFFICULTY.normal;
  return { difficulty: 'normal', sackTime: d.sackTime, coverLag: d.coverLag, intRadius: d.intRadius, weather: 'clear', fumbleMult: 1, bullet: true, trucking: true, fatigue: true, injuries: false, penalties: false, liveReturns: true, ...over };
}

export function teams(a = 'SEA', b = 'LAR', offA = 80, defA = 80, offB = 80, defB = 80): SimTeams {
  const rosters: SimTeams['rosters'] = [buildRoster(a, offA, defA), buildRoster(b, offB, defB)];
  return { rosters, cond: [rosters[0].map(() => 1), rosters[1].map(() => 1)], armFatigue: [0, 0] };
}

export function desc(over: Partial<PlayDesc> = {}): PlayDesc {
  return { id: 1, type: 'scrimmage' as PlayType, seed: 42, offense: 0 as Seat, dir: 1, los: 40, down: 1, toGo: 10, playbook: 1, clock: 180, ...over };
}

export function play(over: Partial<PlayDesc> = {}, c: Partial<SimCfg> = {}, t: SimTeams = teams()): SimState {
  return createPlay(desc(over), t, cfg(c));
}
