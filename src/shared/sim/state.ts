// The play simulation state. Plain data, so it can be sent as JSON at a handoff.
import type { Role, RosterPlayer } from '../data/roster';
import type { Difficulty, Weather } from '../data/config';

export type Seat = 0 | 1;
export type PlayType = 'scrimmage' | 'twoPoint' | 'kickoff' | 'freeKick' | 'onside' | 'punt' | 'fieldGoal' | 'extraPoint';
export const PHASES = ['pre', 'pocket', 'flight', 'run', 'loose', 'kickPower', 'kickAim', 'kickFlight', 'dead'] as const;
export type SimPhase = (typeof PHASES)[number];

export type Job = 'idle' | 'qb' | 'mesh' | 'route' | 'block' | 'rush' | 'cover' | 'deep' | 'zone' | 'pursue' | 'carry' | 'lead' | 'chase' | 'kickCover' | 'return' | 'kicker';

/** Animation IDs. Frames carry these as one byte; the art layer maps them to sprites. */
export const A = {
  stance: 0, run: 1, runBall: 2, backpedal: 3, dropBack: 4, aim: 5, throw: 6, handoff: 7, scramble: 8, sacked: 9,
  catch: 10, drop: 11, jukeL: 12, jukeR: 13, stiff: 14, dive: 15, truck: 16, tackled: 17, fumble: 18, getUp: 19,
  block: 20, push: 21, pushed: 22, rush: 23, tackle: 24, sack: 25, int: 26,
  kickStance: 27, kickApproach: 28, kick: 29, onside: 30, celebrate: 31, hold: 32, punt: 33,
  spike: 34, taunt: 35, kneel: 36, pile: 37, hurt: 38, helped: 39, tdDance: 40,
} as const;

/** Event bits collected into frames, so a watcher can play the same sounds. */
export const EV = {
  snap: 1, throw: 2, catch: 4, drop: 8, tackle: 16, grunt: 32, stiff: 64, dive: 128,
  kick: 256, post: 512, whistle: 1024, fumble: 2048, int: 4096, td: 8192, juke: 16384, bigPlay: 32768,
} as const;

export type PlayEnd =
  | 'tackle' | 'oob' | 'incomplete' | 'td' | 'pi'
  | 'touchback' | 'fumbleOutEndZone' | 'tryFailed'
  | 'fgGood' | 'fgMiss' | 'xpGood' | 'xpMiss' | 'kickOut';

export interface PlayStats { att: number; comp: number; passYds: number; rushYds: number; sacks: number; int: number; fumLost: number; retYds: number }

export interface PlayResult {
  playId: number;
  type: PlayType;
  end: PlayEnd;
  spotX: number;
  /** Team with the ball when the play ended. */
  possessor: Seat;
  /** Team on offense at the snap, or the kicking team. */
  offense: Seat;
  clock: number;
  /** True if the ball was gained inside the holder's own end zone from the other team and never left. */
  ezImpetus: boolean;
  /** The team that last held the ball, for fumbles out of an end zone. */
  lastCarrier: Seat;
  sack: boolean;
  safetyByKnee?: boolean;
  stats: [PlayStats, PlayStats];
  /** Condition changes: [seat, slot, delta]. */
  touches: [Seat, number, number][];
  armFatigue: [number, number];
  injury: [Seat, number] | null;
  yards: number;
  big: boolean;
  /** Text for the commentary strip, built by the sim where it knows the actors. */
  note?: string;
}

export interface SimCfg {
  difficulty: Difficulty;
  sackTime: number; coverLag: number; intRadius: number;
  weather: Weather;
  fumbleMult: number;
  bullet: boolean; trucking: boolean; fatigue: boolean; injuries: boolean; penalties: boolean;
  liveReturns: boolean;
}

export interface PlayDesc {
  id: number;
  type: PlayType;
  seed: number;
  offense: Seat;
  dir: 1 | -1;
  los: number;
  down: number;
  toGo: number;
  playbook: number;
  clock: number;
}

export interface SimPlayer {
  i: number; seat: Seat; role: Role; slot: number;
  x: number; y: number; vx: number; vy: number; face: 1 | -1; anim: number;
  top: number; str: number; tck: number; cat: number; blk: number; sta: number; cond: number;
  job: Job; target: number; engaged: number; shed: number;
  route: number[] | null; routeI: number; routeStop: boolean;
  stun: number; tackleCd: number; ran: number; ax: number; ay: number;
}

export interface BallState {
  x: number; y: number; z: number;
  holder: number;
  sx: number; sy: number; ex: number; ey: number; t: number; dur: number; peak: number; startZ: number; endZ: number;
  vx: number; vy: number; bounce: number;
}

export interface PassState { bullet: boolean; target: number; piFlag: boolean; piSpotX: number; piChecked: boolean; distance: number; thrownFromX: number }

export interface KickState {
  meter: number; meterDir: 1 | -1; power: number;
  arrow: number; arrowDir: 1 | -1; aim: number; arrowHz: number;
  range: number; distance: number; landX: number; landY: number;
  kicked: boolean; landed: boolean; caught: boolean; good: boolean; returner: number; postHit: boolean;
  onsideRoll: number; ezWindowT: number; ezPending: boolean; ranOut: boolean;
  acc: number;
}

export interface Gestures {
  jukeT: number; jukeDir: number; lastJukeAt: number; jukeLoss: number;
  stiffT: number; stiffsLeft: number;
  diveT: number; diveGain: number;
  slowT: number; truck: boolean; truckMeter: number; hitSlowT: number;
  lastGestureAt: number; ballT: number;
}

export interface SimState {
  v: 1;
  rng: number;
  tick: number;
  t: number;
  snapT: number;
  desc: PlayDesc;
  cfg: SimCfg;
  phase: SimPhase;
  phaseT: number;
  players: SimPlayer[];
  ball: BallState;
  possessor: Seat;
  lastCarrier: Seat;
  control: Seat;
  clock: number;
  clockRun: boolean;
  aim: { on: boolean; dx: number; dy: number; heldFrom: number; bullet: boolean };
  armRange: number; qbAcc: number; qbArmFatigue: number;
  pass: PassState | null;
  kick: KickState | null;
  g: Gestures;
  defCall: 'man' | 'blitz' | 'soft';
  handoff: { to: Seat; reason: 'int' | 'fumble' | 'kick' | 'onside'; spotX: number } | null;
  frozen: boolean;
  autoRun: boolean;
  ezImpetus: boolean;
  /** Seconds left to run out of the holder's own end zone. No input means a touchback. */
  ezWait: number;
  ezRanOut: boolean;
  scrambled: boolean;
  ran: boolean;
  force: '' | 'int' | 'fumble' | 'sack';
  forceRecover: -1 | Seat;
  ev: number;
  result: PlayResult | null;
  deadT: number;
  finished: boolean;
  stats: [PlayStats, PlayStats];
  touches: [Seat, number, number][];
  armFatigue: [number, number];
  injury: [Seat, number] | null;
  catchX: number;
  /** Set when this tick resolved a catch, for the banner and tests. */
  note: string;
}

export type SimInput =
  | { k: 'snap' } | { k: 'handoff' } | { k: 'qbRun' }
  | { k: 'aimStart' } | { k: 'aim'; dx: number; dy: number } | { k: 'bullet' } | { k: 'throw' } | { k: 'aimCancel' }
  | { k: 'swipe'; dx: number; dy: number } | { k: 'truck'; on: boolean }
  | { k: 'tap' };

export interface SimTeams { rosters: [RosterPlayer[], RosterPlayer[]]; cond: [number[], number[]]; armFatigue: [number, number] }

export function emptyStats(): PlayStats { return { att: 0, comp: 0, passYds: 0, rushYds: 0, sacks: 0, int: 0, fumLost: 0, retYds: 0 }; }

export function dirOf(s: { desc: PlayDesc }, seat: Seat): 1 | -1 { return seat === s.desc.offense ? s.desc.dir : ((-s.desc.dir) as 1 | -1); }
export function goalX(dir: number): number { return dir > 0 ? 110 : 10; }
export function inOwnEndZone(x: number, dir: number): boolean { return dir > 0 ? x <= 10 : x >= 110; }
export function inOppEndZone(x: number, dir: number): boolean { return dir > 0 ? x >= 110 : x <= 10; }
export function isKickType(t: PlayType): boolean { return t === 'kickoff' || t === 'freeKick' || t === 'onside' || t === 'punt' || t === 'fieldGoal' || t === 'extraPoint'; }
