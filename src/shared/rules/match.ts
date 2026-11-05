// The match rules as pure functions: (match, event) -> match.
import { DIFFICULTY, type MatchConfig, type Weather } from '../data/config';
import { pickPlay } from '../data/playbook';
import { adjustScore, buildRoster, kickRange, KICKER_SLOT, type RosterPlayer } from '../data/roster';
import { TEAM_BY_ID } from '../data/teams';
import { mixSeed } from '../sim/rng';
import { isKickType, type PlayDesc, type PlayResult, type PlayStats, type PlayType, type Seat, type SimCfg, type SimTeams } from '../sim/state';
import { T } from '../sim/tuning';
import { checkTwoMinute, quarterSeconds, runoffSeconds, settleRunoff, timeoutsPerHalf } from './clock';
import { advanceDowns, clampSpot, setFirstDown, setTouchback, xFromOwn, yardsToGoal } from './downs';
import { otOnDriveEnd, type OtState } from './overtime';
import { addPoints, POINTS, scoreFieldGoal, scoreSafety, scoreTouchdown } from './scoring';

export type MatchPhase = 'coinToss' | 'kickChoice' | 'presnap' | 'choice4th' | 'conversion' | 'live' | 'banner' | 'replay' | 'final';

export interface TeamStats extends PlayStats { top: number }

export type Next =
  | { k: 'scrimmage' }
  | { k: 'conversion' }
  | { k: 'kick'; kicker: Seat; kind: 'kickoff' | 'freeKick' }
  | { k: 'final' };

export type BannerKind = 'quarter' | 'half' | 'twoMin' | 'overtime' | 'touchdown' | 'score';

export interface LastPlay {
  end: PlayResult['end']; type: PlayType; yards: number; possessor: Seat; offense: Seat; sack: boolean; big: boolean; turnover: boolean;
  firstDown: boolean; note: string; scored: number; turnoverOnDowns: boolean; safety: boolean; touchback: boolean;
}

export interface MatchState {
  config: MatchConfig;
  teams: [string, string];
  scores: [[number, number], [number, number]];
  /** Which seat wears the white away kit. */
  away: [boolean, boolean];
  seed: number;
  weather: Weather;
  phase: MatchPhase;
  period: number;
  clock: number;
  runoffPending: boolean;
  twoMinUsed: boolean;
  possession: Seat;
  attack: [1 | -1, 1 | -1];
  ballX: number;
  down: number;
  toGo: number;
  chosen4th: boolean;
  playId: number;
  play: PlayDesc | null;
  kicker: Seat;
  kickKind: 'kickoff' | 'freeKick';
  score: [number, number];
  scoreByPeriod: [number[], number[]];
  timeouts: [number, number];
  audibles: [number, number];
  pauses: [number, number];
  coinWinner: Seat;
  openingKicker: Seat;
  ot: OtState | null;
  winner: Seat | 'tie' | null;
  banner: { kind: BannerKind; text: string } | null;
  after: Next;
  condition: [number[], number[]];
  armFatigue: [number, number];
  injured: [number[], number[]];
  stats: [TeamStats, TeamStats];
  last: LastPlay | null;
  conceded: Seat | null;
}

const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const other = (s: Seat): Seat => (1 - s) as Seat;

function emptyTeamStats(): TeamStats { return { att: 0, comp: 0, passYds: 0, rushYds: 0, sacks: 0, int: 0, fumLost: 0, retYds: 0, top: 0 }; }

function resolveWeather(c: MatchConfig, seed: number): Weather {
  if (c.weather !== 'random') return c.weather;
  return (['clear', 'rain', 'snow', 'wind'] as const)[mixSeed(seed, 77) % 4];
}

/** Needs a second kit when both pick the same team or their colours are too close. */
export function awayKits(a: string, b: string): [boolean, boolean] {
  if (a === b) return [false, true];
  return [false, coloursTooClose(TEAM_BY_ID[a].primary, TEAM_BY_ID[b].primary)];
}

function coloursTooClose(c1: string, c2: string): boolean {
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(c1);
  const [r2, g2, b2] = rgb(c2);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < T.kit.closeColor;
}

export function createMatch(config: MatchConfig, teams: [string, string], seed: number): MatchState {
  const coinWinner = (mixSeed(seed, 1) % 2) as Seat; // the winner receives
  const t0 = TEAM_BY_ID[teams[0]];
  const t1 = TEAM_BY_ID[teams[1]];
  const scored = (t: typeof t0): [number, number] => [adjustScore(t.off, config.ratings), adjustScore(t.def, config.ratings)];
  const m: MatchState = {
    config: clone(config), teams, scores: [scored(t0), scored(t1)], away: awayKits(teams[0], teams[1]), seed,
    weather: resolveWeather(config, seed),
    phase: 'coinToss', period: 1, clock: config.quarter * 60, runoffPending: false, twoMinUsed: false,
    possession: other(coinWinner), attack: [1, -1], ballX: 60, down: 1, toGo: 10, chosen4th: false,
    playId: 0, play: null, kicker: other(coinWinner), kickKind: 'kickoff',
    score: [0, 0], scoreByPeriod: [[0, 0, 0, 0], [0, 0, 0, 0]],
    timeouts: [0, 0], audibles: [config.audibles, config.audibles], pauses: [config.pauses, config.pauses],
    coinWinner, openingKicker: other(coinWinner), ot: null, winner: null, banner: null, after: { k: 'scrimmage' },
    condition: [new Array<number>(17).fill(1), new Array<number>(17).fill(1)],
    armFatigue: [0, 0], injured: [[], []], stats: [emptyTeamStats(), emptyTeamStats()], last: null, conceded: null,
  };
  const n = timeoutsPerHalf(m);
  m.timeouts = [n, n];
  return m;
}

export function effectiveRoster(m: MatchState, seat: Seat): RosterPlayer[] {
  const [off, def] = m.scores[seat];
  const r = buildRoster(m.teams[seat], off, def);
  // A hurt player is replaced by a backup rated 2 lower.
  for (const slot of m.injured[seat]) {
    const p = r[slot];
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = Math.max(T.attr.min, p.attrs[k] - T.attr.backupPenalty);
    p.star = false;
    p.name = `${p.name.slice(0, 2)}${p.name.slice(2, 6)}II`;
  }
  return r;
}

export function simContext(m: MatchState): { teams: SimTeams; cfg: SimCfg } {
  const rosters: [RosterPlayer[], RosterPlayer[]] = [effectiveRoster(m, 0), effectiveRoster(m, 1)];
  const d = DIFFICULTY[m.config.difficulty];
  const fumbleMult = m.config.fumbles === 'off' ? 0 : m.config.fumbles === 'high' ? T.contact.fumbleHighMult : 1;
  return {
    teams: { rosters, cond: m.config.fatigue ? m.condition : [rosters[0].map(() => 1), rosters[1].map(() => 1)], armFatigue: m.config.fatigue ? m.armFatigue : [0, 0] },
    cfg: {
      difficulty: m.config.difficulty, sackTime: d.sackTime, coverLag: d.coverLag, intRadius: d.intRadius, weather: m.weather,
      fumbleMult, bullet: m.config.bullet, trucking: m.config.trucking, fatigue: m.config.fatigue, injuries: m.config.injuries,
      penalties: m.config.penalties, liveReturns: m.config.returns === 'live',
    },
  };
}

// --- Offering plays ----------------------------------------------------------

function playSeed(m: MatchState): number { return mixSeed(m.seed, m.playId); }

function makeDesc(m: MatchState, type: PlayType, offense: Seat, los: number, playbook = 0): PlayDesc {
  const scrimmage = type === 'scrimmage';
  const clock = scrimmage && m.runoffPending ? m.clock - runoffSeconds(m) : m.clock;
  return { id: m.playId, type, seed: playSeed(m), offense, dir: m.attack[offense], los, down: m.down, toGo: m.toGo, playbook, clock };
}

function offerScrimmage(m: MatchState, exclude = -1): void {
  m.playId += 1;
  const roll = (mixSeed(playSeed(m), 3) % 1000) / 1000;
  const play = pickPlay(roll, m.down, m.toGo, exclude);
  m.play = makeDesc(m, 'scrimmage', m.possession, m.ballX, play.id);
  m.phase = 'presnap';
}

function offerChoiceOrPlay(m: MatchState): void {
  if (m.down === 4 && !m.chosen4th) { m.phase = 'choice4th'; m.play = null; return; }
  offerScrimmage(m);
}

function prepareKick(m: MatchState, kicker: Seat, kind: 'kickoff' | 'freeKick'): void {
  m.kicker = kicker;
  m.kickKind = kind;
  m.possession = kicker;
  m.chosen4th = false;
  m.down = 1;
  m.toGo = 10;
  m.runoffPending = false;
  if (m.config.onside && m.score[kicker] <= m.score[other(kicker)]) { m.phase = 'kickChoice'; m.play = null; return; }
  startKick(m, kind);
}

function startKick(m: MatchState, type: 'kickoff' | 'freeKick' | 'onside'): void {
  const own = m.kickKind === 'freeKick' ? T.kick.freeKickYard : T.kick.kickoffYard;
  m.playId += 1;
  m.play = makeDesc(m, type, m.kicker, xFromOwn(own, m.attack[m.kicker]));
  m.phase = 'presnap';
}

function startConversionKick(m: MatchState): void {
  const dir = m.attack[m.possession];
  m.playId += 1;
  const los = dir > 0 ? 110 - T.rules.xpLosYards : 10 + T.rules.xpLosYards;
  m.play = makeDesc(m, 'extraPoint', m.possession, los);
  m.phase = 'presnap';
}

function startTwoPoint(m: MatchState): void {
  const dir = m.attack[m.possession];
  m.playId += 1;
  const los = dir > 0 ? 110 - T.rules.twoPointSpot : 10 + T.rules.twoPointSpot;
  const roll = (mixSeed(playSeed(m), 3) % 1000) / 1000;
  const play = pickPlay(roll, 1, T.rules.twoPointSpot);
  m.play = { ...makeDesc(m, 'twoPoint', m.possession, los, play.id), down: 1, toGo: T.rules.twoPointSpot };
  m.phase = 'presnap';
}

function gotoNext(m: MatchState): void {
  const n = m.after;
  m.banner = null;
  switch (n.k) {
    case 'scrimmage': offerChoiceOrPlay(m); break;
    case 'conversion':
      if (m.config.twoPoint) { m.phase = 'conversion'; m.play = null; }
      else startConversionKick(m);
      break;
    case 'kick': prepareKick(m, n.kicker, n.kind); break;
    case 'final': m.phase = 'final'; m.play = null; break;
  }
}

// --- Events ------------------------------------------------------------------

/** After the coin toss banner. The winner receives. */
export function afterCoinToss(prev: MatchState): MatchState {
  const m = clone(prev);
  prepareKick(m, m.openingKicker, 'kickoff');
  return m;
}

export function applySnap(prev: MatchState): MatchState {
  const m = clone(prev);
  if (m.play && m.play.type === 'scrimmage' && m.runoffPending) {
    const run = runoffSeconds(m);
    m.clock = Math.max(0, m.clock - run);
    m.stats[m.possession].top += run;
  }
  m.runoffPending = false;
  if (m.play) m.play.clock = m.clock;
  m.phase = 'live';
  return m;
}

export type Choice = 'go' | 'punt' | 'fg' | 'kick' | 'two' | 'deep' | 'onside';

export function fieldGoalDistance(m: MatchState): number {
  const dir = m.attack[m.possession];
  return yardsToGoal(m.ballX, dir) + T.kick.kickerBehindLos + T.field.ez;
}

export function fieldGoalInRange(m: MatchState): boolean {
  const k = effectiveRoster(m, m.possession)[KICKER_SLOT];
  return fieldGoalDistance(m) <= kickRange(k.attrs.rng);
}

export function isChoiceLegal(m: MatchState, c: Choice): boolean {
  switch (m.phase) {
    case 'choice4th': return c === 'go' || c === 'punt' || c === 'fg';
    case 'conversion': return c === 'kick' || (c === 'two' && m.config.twoPoint);
    case 'kickChoice': return c === 'deep' || c === 'onside';
    default: return false;
  }
}

export function applyChoice(prev: MatchState, c: Choice): MatchState {
  const m = clone(prev);
  if (!isChoiceLegal(m, c)) return m;
  switch (c) {
    case 'go': m.chosen4th = true; offerScrimmage(m); break;
    case 'punt': m.chosen4th = true; m.playId += 1; m.play = makeDesc(m, 'punt', m.possession, m.ballX); m.phase = 'presnap'; break;
    case 'fg': m.chosen4th = true; m.playId += 1; m.play = makeDesc(m, 'fieldGoal', m.possession, m.ballX); m.phase = 'presnap'; break;
    case 'kick': startConversionKick(m); break;
    case 'two': startTwoPoint(m); break;
    case 'deep': startKick(m, m.kickKind); break;
    case 'onside': startKick(m, 'onside'); break;
  }
  return m;
}

/** What the play clock chooses when it runs out on an open choice. */
export function defaultChoice(m: MatchState): Choice {
  if (m.phase === 'conversion') return 'kick';
  if (m.phase === 'kickChoice') return 'deep';
  return fieldGoalInRange(m) ? 'fg' : 'punt';
}

/** Only the offense may call one. On 4th down it reopens the choice. */
export function canTimeout(m: MatchState, seat: Seat): boolean {
  if (m.possession !== seat || m.timeouts[seat] <= 0) return false;
  if (m.phase === 'choice4th') return true;
  if (m.phase !== 'presnap' || !m.play) return false;
  return m.play.type === 'scrimmage' || m.play.type === 'punt' || m.play.type === 'fieldGoal';
}

export function applyTimeout(prev: MatchState, seat: Seat): MatchState {
  const m = clone(prev);
  if (!canTimeout(m, seat)) return m;
  m.timeouts[seat] -= 1;
  m.runoffPending = false;
  if (m.down === 4) { m.chosen4th = false; m.phase = 'choice4th'; m.play = null; }
  else if (m.play) m.play.clock = m.clock;
  return m;
}

export function canAudible(m: MatchState, seat: Seat): boolean {
  return m.phase === 'presnap' && m.possession === seat && m.audibles[seat] > 0 && !!m.play && (m.play.type === 'scrimmage' || m.play.type === 'twoPoint');
}

export function applyAudible(prev: MatchState, seat: Seat): MatchState {
  const m = clone(prev);
  if (!canAudible(m, seat) || !m.play) return m;
  m.audibles[seat] -= 1;
  const old = m.play;
  m.playId += 1;
  const roll = (mixSeed(playSeed(m), 3) % 1000) / 1000;
  const play = pickPlay(roll, old.down, old.toGo, old.playbook);
  m.play = { ...old, id: m.playId, seed: playSeed(m), playbook: play.id };
  return m;
}

export function advanceBanner(prev: MatchState): MatchState {
  const m = clone(prev);
  gotoNext(m);
  return m;
}

export function concede(prev: MatchState, seat: Seat): MatchState {
  const m = clone(prev);
  m.winner = other(seat);
  m.conceded = seat;
  m.phase = 'final';
  m.play = null;
  return m;
}

// --- Resolving a play --------------------------------------------------------

function inOwnEz(x: number, dir: number): boolean { return dir > 0 ? x <= 10 : x >= 110; }
function inOppEz(x: number, dir: number): boolean { return dir > 0 ? x >= 110 : x <= 10; }

interface Flags { clockRunning: boolean; firstDown: boolean; scored: number; turnoverOnDowns: boolean; safety: boolean; touchback: boolean }

function safety(m: MatchState, conceding: Seat, f: Flags): void {
  scoreSafety(m, other(conceding));
  f.safety = true;
  f.scored = POINTS.safety;
  m.possession = conceding;
  m.after = { k: 'kick', kicker: conceding, kind: 'freeKick' };
}

function touchdown(m: MatchState, team: Seat, f: Flags): void {
  scoreTouchdown(m, team);
  f.scored = POINTS.td;
  m.possession = team;
  m.after = { k: 'conversion' };
}

/** A dead ball anywhere on the field, for the team holding it. */
function deadBall(m: MatchState, r: PlayResult, f: Flags, inBounds: boolean): void {
  const pos = r.possessor;
  const dir = m.attack[pos];
  if (inOwnEz(r.spotX, dir)) {
    if (r.ezImpetus) { setTouchback(m, pos); f.touchback = true; }
    else { safety(m, pos, f); return; }
    m.after = { k: 'scrimmage' };
    return;
  }
  m.after = { k: 'scrimmage' };
  if (pos !== r.offense || isKickType(r.type)) { setFirstDown(m, pos, r.spotX); return; }
  const before = m.possession;
  f.turnoverOnDowns = advanceDowns(m, pos, r.spotX);
  f.firstDown = m.down === 1 && m.possession === before;
  f.clockRunning = inBounds && !f.turnoverOnDowns;
}

function resolveScrimmage(m: MatchState, r: PlayResult, f: Flags): void {
  const off = r.offense;
  switch (r.end) {
    case 'td': touchdown(m, r.possessor, f); return;
    case 'incomplete':
      m.after = { k: 'scrimmage' };
      f.turnoverOnDowns = advanceDowns(m, off, m.ballX);
      return;
    case 'pi': {
      // Automatic first down at the spot of the foul.
      const dir = m.attack[off];
      setFirstDown(m, off, inOppEz(r.spotX, dir) ? (dir > 0 ? 109 : 11) : r.spotX);
      f.firstDown = true;
      m.after = { k: 'scrimmage' };
      return;
    }
    case 'touchback':
      setTouchback(m, r.possessor);
      f.touchback = true;
      m.after = { k: 'scrimmage' };
      return;
    case 'fumbleOutEndZone': {
      const last = r.lastCarrier;
      const dir = m.attack[last];
      if (inOwnEz(r.spotX, dir)) { safety(m, last, f); return; } // the carrier's own end zone
      setTouchback(m, other(last)); // the defending team's end zone
      f.touchback = true;
      m.after = { k: 'scrimmage' };
      return;
    }
    default:
      deadBall(m, r, f, r.end === 'tackle');
  }
}

function resolveKickPlay(m: MatchState, r: PlayResult, f: Flags): void {
  switch (r.end) {
    case 'td': touchdown(m, r.possessor, f); return;
    case 'touchback':
      setTouchback(m, r.possessor);
      f.touchback = true;
      m.after = { k: 'scrimmage' };
      return;
    case 'kickOut':
      setFirstDown(m, r.possessor, r.spotX);
      m.after = { k: 'scrimmage' };
      return;
    case 'fumbleOutEndZone': {
      const last = r.lastCarrier;
      if (inOwnEz(r.spotX, m.attack[last])) { safety(m, last, f); return; }
      setTouchback(m, other(last));
      f.touchback = true;
      m.after = { k: 'scrimmage' };
      return;
    }
    default:
      deadBall(m, r, f, false);
  }
}

function resolveFieldGoal(m: MatchState, r: PlayResult, f: Flags): void {
  const off = r.offense;
  if (r.end === 'fgGood') {
    scoreFieldGoal(m, off);
    f.scored = POINTS.fg;
    m.after = { k: 'kick', kicker: off, kind: 'kickoff' };
    return;
  }
  // A miss: the other team takes over at the spot of the kick.
  setFirstDown(m, other(off), clampSpot(r.spotX));
  m.after = { k: 'scrimmage' };
}

function resolveTry(m: MatchState, r: PlayResult, f: Flags): void {
  const off = r.offense;
  if (r.type === 'extraPoint') {
    if (r.end === 'xpGood') { addPoints(m, off, POINTS.xp); f.scored = POINTS.xp; }
  } else if (r.end === 'td' && r.possessor === off) {
    addPoints(m, off, POINTS.two);
    f.scored = POINTS.two;
  }
  m.possession = off;
  m.after = { k: 'kick', kicker: off, kind: 'kickoff' };
}

function changeEnds(m: MatchState): void {
  m.attack = [(-m.attack[0]) as 1 | -1, (-m.attack[1]) as 1 | -1];
  m.ballX = 120 - m.ballX;
}

function resetHalf(m: MatchState, timeouts: number): void {
  m.timeouts = [timeouts, timeouts];
  m.audibles = [m.config.audibles, m.config.audibles];
}

function endPeriod(m: MatchState): void {
  const p = m.period;
  m.runoffPending = false;
  if (p === 1 || p === 3) {
    m.period += 1;
    m.clock = quarterSeconds(m);
    changeEnds(m);
    m.banner = { kind: 'quarter', text: `END OF Q${p}` };
    m.phase = 'banner';
    return;
  }
  if (p === 2) {
    m.period = 3;
    m.clock = quarterSeconds(m);
    m.twoMinUsed = false;
    changeEnds(m);
    resetHalf(m, timeoutsPerHalf(m));
    // The team that kicked first receives.
    m.after = { k: 'kick', kicker: other(m.openingKicker), kind: 'kickoff' };
    m.banner = { kind: 'half', text: 'HALFTIME' };
    m.phase = 'banner';
    return;
  }
  if (p === 4 && m.score[0] === m.score[1] && m.config.overtime !== 'off') {
    m.period = 5;
    m.clock = quarterSeconds(m);
    changeEnds(m);
    resetHalf(m, T.clock.otTimeouts);
    m.scoreByPeriod[0].push(0);
    m.scoreByPeriod[1].push(0);
    const receiver = (mixSeed(m.seed, 99 + m.playId) % 2) as Seat; // always a coin flip, since both sides are human
    m.coinWinner = receiver;
    m.ot = { mode: m.config.overtime === 'sudden' ? 'sudden' : 'standard', first: receiver, stage: m.config.overtime === 'sudden' ? 'sudden' : 'first' };
    m.after = { k: 'kick', kicker: other(receiver), kind: 'kickoff' };
    m.banner = { kind: 'overtime', text: 'OVERTIME' };
    m.phase = 'banner';
    return;
  }
  finish(m);
}

function finish(m: MatchState): void {
  if (m.winner === null) m.winner = m.score[0] === m.score[1] ? 'tie' : m.score[0] > m.score[1] ? 0 : 1;
  m.after = { k: 'final' };
  m.phase = 'final';
  m.play = null;
}

function mergeResultStats(m: MatchState, r: PlayResult, used: number): void {
  for (const s of [0, 1] as Seat[]) {
    const a = m.stats[s];
    const b = r.stats[s];
    a.att += b.att; a.comp += b.comp; a.passYds += b.passYds; a.rushYds += b.rushYds; a.sacks += b.sacks; a.int += b.int; a.fumLost += b.fumLost; a.retYds += b.retYds;
    m.armFatigue[s] = Math.min(T.pass.armFatigueMax, m.armFatigue[s] + (r.armFatigue[s] ?? 0));
  }
  m.stats[r.offense].top += used;
  for (const [seat, slot, delta] of r.touches) m.condition[seat][slot] = Math.max(0, Math.min(1, m.condition[seat][slot] + delta));
  if (r.injury && !m.injured[r.injury[0]].includes(r.injury[1])) m.injured[r.injury[0]].push(r.injury[1]);
}

/** Basic sanity checks on a reported result. Browsers are trusted, but this catches bugs. */
export function isResultValid(m: MatchState, r: PlayResult): boolean {
  if (!m.play || r.playId !== m.play.id || r.type !== m.play.type) return false;
  if (!(r.spotX >= 0 && r.spotX <= T.field.len)) return false;
  if (r.possessor !== 0 && r.possessor !== 1) return false;
  if (!(r.clock <= m.clock + 0.01) || r.clock < 0) return false;
  return true;
}

export function applyResult(prev: MatchState, r: PlayResult): MatchState {
  const m = clone(prev);
  const used = Math.max(0, m.clock - r.clock);
  m.clock = r.clock;
  mergeResultStats(m, r, used);
  const prevPos = m.possession;
  const f: Flags = { clockRunning: false, firstDown: false, scored: 0, turnoverOnDowns: false, safety: false, touchback: false };
  switch (r.type) {
    case 'scrimmage': resolveScrimmage(m, r, f); break;
    case 'twoPoint': case 'extraPoint': resolveTry(m, r, f); break;
    case 'fieldGoal': resolveFieldGoal(m, r, f); break;
    default: resolveKickPlay(m, r, f); break;
  }
  const turnover = r.possessor !== r.offense && !isKickType(r.type);
  m.last = {
    end: r.end, type: r.type, yards: r.yards, possessor: r.possessor, offense: r.offense, sack: r.sack, big: r.big, turnover,
    firstDown: f.firstDown, note: r.note ?? '', scored: f.scored, turnoverOnDowns: f.turnoverOnDowns, safety: f.safety, touchback: f.touchback,
  };
  // Overtime: the ball changed hands with no score.
  if (m.ot && m.winner === null && f.scored === 0 && m.possession !== prevPos && (r.type === 'scrimmage' || r.type === 'punt' || r.type === 'fieldGoal')) otOnDriveEnd(m);
  if (m.winner !== null) { finish(m); return m; }
  settleRunoff(m, f.clockRunning);
  // A conversion after a touchdown is still played at 0:00.
  if (m.after.k === 'conversion') { gotoNext(m); return m; }
  if (m.clock <= 0) { endPeriod(m); return m; }
  if (checkTwoMinute(m)) {
    m.banner = { kind: 'twoMin', text: 'TWO-MINUTE WARNING' };
    m.phase = 'banner';
    return m;
  }
  gotoNext(m);
  return m;
}

/** Voids a play in progress: restores the state from before the snap, with a fresh play. */
export function voidPlay(snapshot: MatchState): MatchState {
  const m = clone(snapshot);
  if (m.play && !isKickType(m.play.type) && m.play.type === 'scrimmage') {
    offerScrimmage(m);
  } else if (m.play) {
    m.playId += 1;
    m.play = { ...m.play, id: m.playId, seed: playSeed(m) };
    m.phase = 'presnap';
  }
  return m;
}

export function currentController(m: MatchState): Seat | null {
  if (m.phase === 'presnap' || m.phase === 'live') return m.play ? m.play.offense : null;
  if (m.phase === 'choice4th' || m.phase === 'conversion') return m.possession;
  if (m.phase === 'kickChoice') return m.kicker;
  return null;
}
