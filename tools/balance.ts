// Bot-versus-AI statistics. Usage: npm run balance -- [plays] [--games N]
import { DEFAULT_CONFIG, DIFFICULTY, type Difficulty, type MatchConfig } from '../src/shared/data/config';
import { TEAMS } from '../src/shared/data/teams';
import { botChoice } from '../src/shared/rules/coach';
import { advanceBanner, afterCoinToss, applyCall, applyChoice, applyResult, applySnap, createMatch, huddleTimeout, simContext, type MatchState } from '../src/shared/rules/match';
import { botCall, coachDefense, coachOffense, type Situation } from '../src/shared/rules/playcall';
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

/** Plays from scrimmage with the coach's calls on both sides, or pinned ones. */
export function runPlays(n: number, offScore: number, defScore: number, difficulty: Difficulty = 'normal', seed = 1, pin: { play?: number; defense?: number } = {}): PlayAgg {
  const rosters: SimTeams['rosters'] = [buildRoster('AAA', offScore, offScore), buildRoster('BBB', defScore, defScore)];
  const teams: SimTeams = { rosters, cond: [rosters[0].map(() => 1), rosters[1].map(() => 1)], armFatigue: [0, 0] };
  const a = agg();
  const c = cfg(difficulty);
  const bot = newBot(seed * 7919);
  for (let i = 0; i < n; i++) {
    const s0 = mixSeed(seed, i);
    const toGo = 10;
    const los = 30 + (i % 40);
    const down = 1 + (i % 3);
    const sit: Situation = { down, toGo, toGoal: 110 - los, clock: 180, period: 1, lead: 0, hurry: false, twoPoint: false, recent: [] };
    const playbook = pin.play ?? coachOffense(sit, mixSeed(s0, 5));
    const defense = pin.defense ?? coachDefense(sit, mixSeed(s0, 7), 2.2);
    const desc: PlayDesc = { id: i + 1, type: 'scrimmage', seed: s0, offense: 0 as Seat, dir: 1, los, down, toGo, playbook, defense, clock: 180 };
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

export interface GameAgg {
  games: number; points: number; turnovers: number; plays: number; sacks: number; att: number; comp: number; passYds: number; rushYds: number; retYds: number; ot: number; ties: number;
  fgTried: number; fgGood: number; xpTried: number; xpGood: number; punts: number; simSeconds: number; yards: number; scrimmage: number; maxPoints: number; minPoints: number;
}

function newGames(): GameAgg {
  return { games: 0, points: 0, turnovers: 0, plays: 0, sacks: 0, att: 0, comp: 0, passYds: 0, rushYds: 0, retYds: 0, ot: 0, ties: 0, fgTried: 0, fgGood: 0, xpTried: 0, xpGood: 0, punts: 0, simSeconds: 0, yards: 0, scrimmage: 0, maxPoints: 0, minPoints: 1e9 };
}

/** A whole match through the real rules, with bots on both sides. */
export function playGame(teams: [string, string], over: Partial<MatchConfig>, seed: number, into: GameAgg = newGames()): MatchState {
  let m = createMatch({ ...DEFAULT_CONFIG, replays: 'off', ...over }, teams, seed);
  const bot = newBot(mixSeed(seed, 42));
  const roll = { rng: mixSeed(seed, 77) };
  for (let guard = 0; m.phase !== 'final' && guard < 2000; guard++) {
    switch (m.phase) {
      case 'coinToss': m = afterCoinToss(m); break;
      case 'banner': case 'replay': m = advanceBanner(m); break;
      case 'huddle': m = huddleCalls(m, roll); break;
      case 'choice4th': case 'conversion': case 'kickChoice': m = applyChoice(m, botChoice(m, rndFrom(roll))!); break;
      case 'presnap': m = runPlay(m, bot, into); break;
      default: throw new Error(`stuck in ${m.phase}`);
    }
  }
  if (m.phase !== 'final') throw new Error('game did not finish');
  const total = m.score[0] + m.score[1];
  into.games += 1;
  into.points += total;
  into.maxPoints = Math.max(into.maxPoints, total);
  into.minPoints = Math.min(into.minPoints, total);
  if (m.period > 4) into.ot += 1;
  if (m.winner === 'tie') into.ties += 1;
  for (const s of [0, 1] as Seat[]) {
    const st = m.stats[s];
    into.turnovers += st.int + st.fumLost;
    into.sacks += st.sacks; into.att += st.att; into.comp += st.comp;
    into.passYds += st.passYds; into.rushYds += st.rushYds; into.retYds += st.retYds;
  }
  return m;
}

/** Both sides call as the browser bot does: mostly the coach's pick, sometimes something else of the same kind. */
function huddleCalls(m: MatchState, roll: { rng: number }): MatchState {
  const h = m.huddle;
  if (!h || !m.play) return huddleTimeout(m);
  const off = m.play.offense;
  let n = applyCall(m, off, 'off', botCall('off', h.suggest[0], rndFrom(roll)));
  if (n.phase === 'huddle' && n.huddle && n.huddle.calls[1] < 0) n = applyCall(n, (1 - off) as Seat, 'def', botCall('def', h.suggest[1], rndFrom(roll)));
  return n.phase === 'huddle' ? huddleTimeout(n) : n;
}

function rndFrom(r: { rng: number }): number {
  r.rng = (r.rng + 0x6d2b79f5) >>> 0;
  let t = r.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function runPlay(m0: MatchState, bot: ReturnType<typeof newBot>, a: GameAgg): MatchState {
  const m = applySnap(m0);
  const ctx = simContext(m);
  const s: SimState = createPlay(m.play!, ctx.teams, ctx.cfg);
  let guard = 0;
  while (!s.finished && guard++ < 20000) {
    if (s.handoff) acceptHandoff(s);
    step(s, botInputs(s, bot, s.control));
  }
  if (!s.result) throw new Error(`play ${s.desc.type} never finished: ${s.phase}`);
  const r = s.result;
  a.plays += 1;
  a.simSeconds += s.t;
  if (r.type === 'fieldGoal') { a.fgTried += 1; if (r.end === 'fgGood') a.fgGood += 1; }
  if (r.type === 'extraPoint') { a.xpTried += 1; if (r.end === 'xpGood') a.xpGood += 1; }
  if (r.type === 'punt') a.punts += 1;
  if (r.type === 'scrimmage') { a.scrimmage += 1; a.yards += r.yards; }
  return applyResult(m, r);
}

/** Yards per play for one side in real games, where end zones and downs cap the gains. */
export function matchup(off: number, def: number, games: number, over: Partial<MatchConfig> = {}, seed = 5): { yPlay: number; yards: number; plays: number; comp: number; sacksPerDropback: number; points: number } {
  let yards = 0;
  let plays = 0;
  let att = 0;
  let comp = 0;
  let sacks = 0;
  let dropbacks = 0;
  let points = 0;
  for (let g = 0; g < games; g++) {
    let m = createMatch({ ...DEFAULT_CONFIG, replays: 'off', overtime: 'off', ...over }, ['AAA' as string, 'BBB'].map(() => 'SEA') as [string, string], mixSeed(seed, g + 1));
    m = { ...m, scores: [[off, 80], [80, def]] };
    const bot = newBot(mixSeed(seed, g + 500));
    const roll = { rng: mixSeed(seed, g + 900) };
    for (let guard = 0; m.phase !== 'final' && guard < 2000; guard++) {
      switch (m.phase) {
        case 'coinToss': m = afterCoinToss(m); break;
        case 'banner': case 'replay': m = advanceBanner(m); break;
        case 'huddle': m = huddleCalls(m, roll); break;
        case 'choice4th': case 'conversion': case 'kickChoice': m = applyChoice(m, botChoice(m, rndFrom(roll))!); break;
        default: {
          const live = applySnap(m);
          const ctx = simContext(live);
          const s = createPlay(live.play!, ctx.teams, ctx.cfg);
          let safety = 0;
          while (!s.finished && safety++ < 20000) { if (s.handoff) acceptHandoff(s); step(s, botInputs(s, bot, s.control)); }
          const r = s.result!;
          if (r.type === 'scrimmage' && r.offense === 0) {
            plays += 1;
            yards += r.yards;
            att += s.stats[0].att; comp += s.stats[0].comp; sacks += s.stats[0].sacks;
            if (!s.ran) dropbacks += 1;
          }
          m = applyResult(live, r);
        }
      }
    }
    points += m.score[0];
  }
  return { yPlay: yards / Math.max(1, plays), yards, plays, comp: comp / Math.max(1, att), sacksPerDropback: dropbacks / Math.max(1, sacks), points: points / games };
}

export function reportGames(name: string, a: GameAgg): string {
  const n = Math.max(1, a.games);
  const f = (x: number, d = 1) => (x / n).toFixed(d);
  const realMin = (a.simSeconds / n) / 60;
  return `${name.padEnd(30)} games ${a.games}  points ${f(a.points)} (${a.minPoints}-${a.maxPoints})  turnovers ${f(a.turnovers)}  plays ${f(a.plays, 0)}  y/play ${(a.yards / Math.max(1, a.scrimmage)).toFixed(2)}  comp ${((100 * a.comp) / Math.max(1, a.att)).toFixed(0)}%  sacks ${f(a.sacks)}  pass ${f(a.passYds, 0)} rush ${f(a.rushYds, 0)} ret ${f(a.retYds, 0)}  FG ${a.fgGood}/${a.fgTried} XP ${a.xpGood}/${a.xpTried} punts ${f(a.punts)}  OT ${a.ot} ties ${a.ties}  live ${realMin.toFixed(1)} min`;
}

export function runGames(n: number, over: Partial<MatchConfig>, teamsFor: (i: number) => [string, string], seed = 1): GameAgg {
  const a = newGames();
  for (let i = 0; i < n; i++) playGame(teamsFor(i), over, mixSeed(seed, i + 1), a);
  return a;
}

if (process.argv[1]?.endsWith('balance.ts')) {
  const n = Number(process.argv[2] ?? 1000);
  const games = Number(process.argv[3] ?? 150);
  console.log(report('Average v average, Normal', runPlays(n, 80, 80)));
  console.log(report('99 OFF v 60 DEF', runPlays(n, 99, 60)));
  console.log(report('60 OFF v 99 DEF', runPlays(n, 60, 99)));
  for (const d of ['easy', 'hard', 'extreme'] as Difficulty[]) console.log(report(`Average, ${d}`, runPlays(n, 80, 80, d)));
  for (const [o, d] of [[80, 80], [99, 60], [60, 99], [99, 99], [60, 60]] as const) {
    const g = matchup(o, d, games);
    console.log(`In games, ${o} OFF v ${d} DEF`.padEnd(30), `y/play ${g.yPlay.toFixed(2)}  comp ${(100 * g.comp).toFixed(0)}%  sack 1 in ${g.sacksPerDropback.toFixed(1)}  points ${g.points.toFixed(1)}`);
  }
  const pair = (i: number): [string, string] => [TEAMS[(i * 7) % 32].id, TEAMS[(i * 11 + 3) % 32].id];
  console.log(reportGames('Standard, Equal ratings', runGames(games, { ratings: 'equal' }, pair)));
  console.log(reportGames('Standard, Real ratings', runGames(games, {}, pair)));
  console.log(reportGames('Quick', runGames(games, { quarter: 1 }, pair)));
  console.log(reportGames('2-minute quarters', runGames(games, { quarter: 2 }, pair)));
  console.log(reportGames('Long (5 min, Hard)', runGames(games, { quarter: 5, difficulty: 'hard' }, pair)));
}
