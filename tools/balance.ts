// Bot-versus-AI statistics. Usage: npm run balance -- [plays] [--games N]
import { DIFFICULTY, type Difficulty } from '../src/shared/data/config';
import { pickPlay } from '../src/shared/data/playbook';
import { buildRoster } from '../src/shared/data/roster';
import { botInputs, newBot } from '../src/shared/sim/bot';
import { acceptHandoff } from '../src/shared/sim/contact';
import { mixSeed } from '../src/shared/sim/rng';
import { createPlay } from '../src/shared/sim/setup';
import { step } from '../src/shared/sim/step';
import type { PlayDesc, Seat, SimCfg, SimState, SimTeams } from '../src/shared/sim/state';

export interface PlayAgg { plays: number; dropbacks: number; att: number; comp: number; sacks: number; ints: number; fumLost: number; yards: number; runs: number; runYds: number; passYds: number; tds: number }

const agg = (): PlayAgg => ({ plays: 0, dropbacks: 0, att: 0, comp: 0, sacks: 0, ints: 0, fumLost: 0, yards: 0, runs: 0, runYds: 0, passYds: 0, tds: 0 });

function cfg(d: Difficulty): SimCfg {
  const v = DIFFICULTY[d];
  return { difficulty: d, sackTime: v.sackTime, coverLag: v.coverLag, intRadius: v.intRadius, weather: 'clear', fumbleMult: 1, bullet: true, trucking: true, fatigue: true, injuries: false, penalties: true, liveReturns: true };
}

export function runPlays(n: number, offScore: number, defScore: number, difficulty: Difficulty = 'normal', seed = 1): PlayAgg {
  const rosters: SimTeams['rosters'] = [buildRoster('AAA', offScore, offScore), buildRoster('BBB', defScore, defScore)];
  const teams: SimTeams = { rosters, cond: [rosters[0].map(() => 1), rosters[1].map(() => 1)], armFatigue: [0, 0] };
  const a = agg();
  const c = cfg(difficulty);
  const bot = newBot(seed * 7919);
  for (let i = 0; i < n; i++) {
    const s0 = mixSeed(seed, i);
    const toGo = 10;
    const play = pickPlay(((s0 >>> 8) % 1000) / 1000, 1 + (i % 3), toGo);
    const desc: PlayDesc = { id: i + 1, type: 'scrimmage', seed: s0, offense: 0 as Seat, dir: 1, los: 30 + (i % 40), down: 1 + (i % 3), toGo, playbook: play.id, clock: 180 };
    const s: SimState = createPlay(desc, teams, c);
    let guard = 0;
    while (!s.finished && guard++ < 3000) {
      if (s.frozen) { acceptHandoff(s); }
      const inp = botInputs(s, bot, s.control);
      step(s, inp);
    }
    const r = s.result!;
    const st = s.stats[0];
    a.plays += 1;
    a.att += st.att; a.comp += st.comp; a.sacks += st.sacks; a.ints += st.int; a.fumLost += st.fumLost;
    a.yards += r.yards;
    if (s.ran) { a.runs += 1; a.runYds += r.yards; } else { a.dropbacks += 1; a.passYds += r.yards; }
    if (r.end === 'td' && r.possessor === 0) a.tds += 1;
  }
  return a;
}

export function report(name: string, a: PlayAgg): string {
  const pct = (x: number, y: number) => (y ? ((100 * x) / y).toFixed(1) : '0.0');
  return `${name.padEnd(26)} plays ${a.plays}  y/play ${(a.yards / a.plays).toFixed(2)}  comp ${pct(a.comp, a.att)}%  sack 1 in ${(a.dropbacks / Math.max(1, a.sacks)).toFixed(1)}  y/pass-play ${(a.passYds / Math.max(1, a.dropbacks)).toFixed(2)}  y/run ${(a.runYds / Math.max(1, a.runs)).toFixed(2)}  INT% ${pct(a.ints, a.att)}  fumLost ${a.fumLost}  TD ${a.tds}`;
}

if (process.argv[1]?.endsWith('balance.ts')) {
  const n = Number(process.argv[2] ?? 1000);
  console.log(report('Average v average, Normal', runPlays(n, 80, 80)));
  console.log(report('99 OFF v 60 DEF', runPlays(n, 99, 60)));
  console.log(report('60 OFF v 99 DEF', runPlays(n, 60, 99)));
  for (const d of ['easy', 'hard', 'extreme'] as Difficulty[]) console.log(report(`Average, ${d}`, runPlays(n, 80, 80, d)));
}
