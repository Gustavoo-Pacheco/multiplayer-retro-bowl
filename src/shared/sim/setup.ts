// Builds the starting state of a play: formations, jobs and defensive call.
import { armRange, DEFENSE_SLOTS, OFFENSE_SLOTS, topSpeed, type RosterPlayer } from '../data/roster';
import { PLAYBOOK, ROUTES, type RouteName } from '../data/playbook';
import { createKick } from './kick';
import { rnd } from './rng';
import { T } from './tuning';
import { emptyStats, type BallState, type PlayDesc, type Seat, type SimCfg, type SimPlayer, type SimState, type SimTeams } from './state';

const CY = T.field.center;

export function makePlayer(i: number, seat: Seat, r: RosterPlayer, cond: number, x: number, y: number, face: 1 | -1): SimPlayer {
  const a = r.attrs;
  return {
    i, seat, role: r.role, slot: r.slot, x, y, vx: 0, vy: 0, face, anim: 0,
    top: topSpeed(a.spd, r.role), str: a.str, tck: a.tck, cat: a.cat, blk: a.blk, sta: a.sta, cond,
    job: 'idle', target: -1, engaged: -1, shed: 0, route: null, routeI: 0, routeStop: false,
    stun: 0, tackleCd: 0, ran: 0, ax: 0, ay: 0,
  };
}

export function baseState(desc: PlayDesc, cfg: SimCfg): Omit<SimState, 'players' | 'ball'> {
  return {
    v: 1, rng: desc.seed >>> 0, tick: 0, t: 0, snapT: 0, desc, cfg, phase: 'pre', phaseT: 0,
    possessor: desc.offense, lastCarrier: desc.offense, control: desc.offense,
    clock: desc.clock, clockRun: false,
    aim: { on: false, dx: 0, dy: 0, heldFrom: 0, bullet: false },
    armRange: 40, qbAcc: 5, qbArmFatigue: 0,
    pass: null, kick: null,
    g: { jukeT: 0, jukeDir: 0, lastJukeAt: -9, jukeLoss: 0, stiffT: 0, stiffsLeft: 0, diveT: 0, diveGain: 0, slowT: 0, truck: false, truckMeter: 0, hitSlowT: 0, lastGestureAt: -9, ballT: 0 },
    defCall: 'man',
    handoff: null, frozen: false, autoRun: false, ezImpetus: false, ezWait: 0, ezRanOut: false, scrambled: false, ran: false,
    force: '', forceRecover: -1, ev: 0, result: null, deadT: 0, finished: false,
    stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, catchX: 0, note: '',
  };
}

export function emptyBall(x: number, y: number): BallState {
  return { x, y, z: 0.6, holder: -1, sx: x, sy: y, ex: x, ey: y, t: 0, dur: 0, peak: 0, startZ: 0, endZ: 0, vx: 0, vy: 0, bounce: 0 };
}

/** Converts a route's [forward, out] offsets into absolute waypoints. */
function buildRoute(name: Exclude<RouteName, 'block'>, x: number, y: number, dir: number, outSign: number): { pts: number[]; stop: boolean } {
  const def = ROUTES[name];
  const pts: number[] = [];
  for (const [f, o] of def.pts) {
    const px = Math.max(0.5, Math.min(T.field.len - 0.5, x + dir * f));
    const py = Math.max(0.6, Math.min(T.field.width - 0.6, y + outSign * o));
    pts.push(px, py);
  }
  return { pts, stop: def.stop };
}

export function createPlay(desc: PlayDesc, teams: SimTeams, cfg: SimCfg): SimState {
  return desc.type === 'scrimmage' || desc.type === 'twoPoint' ? createScrimmage(desc, teams, cfg) : createKick(desc, teams, cfg);
}

export function createScrimmage(desc: PlayDesc, teams: SimTeams, cfg: SimCfg): SimState {
  const base = baseState(desc, cfg);
  const dir = desc.dir;
  const los = desc.los;
  const off = desc.offense;
  const def = (1 - off) as Seat;
  const rO = teams.rosters[off];
  const rD = teams.rosters[def];
  const cO = teams.cond[off];
  const cD = teams.cond[def];
  const lat = (l: number) => CY + l * dir; // mirrored with direction, so receivers swap sides at a change of ends
  const xAt = (f: number) => Math.max(0.5, Math.min(T.field.len - 0.5, los + dir * f));
  const faceO = (dir > 0 ? 1 : -1) as 1 | -1;
  const faceD = (-faceO) as 1 | -1;

  const offSpots: [number, number][] = [
    [-3, 0], // QB
    [-4, 1.6], // RB
    [-0.6, -6.6], [-0.6, 6.6], // WR, WR
    [-0.6, 3.4], // TE
    [-0.6, -1.7], [-0.6, 0], [-0.6, 1.7], // OL
  ];
  const players: SimPlayer[] = OFFENSE_SLOTS.map((slot, n) => {
    const [f, l] = offSpots[n];
    return makePlayer(n, off, rO[slot], cO[slot] ?? 1, xAt(f), lat(l), faceO);
  });

  const rngHolder = { rng: desc.seed ^ 0x5bd1e995 };
  const roll = rnd(rngHolder);
  const defCall: SimState['defCall'] = roll < T.ai.blitzChance ? 'blitz' : roll < T.ai.blitzChance + T.ai.softChance ? 'soft' : 'man';
  const shortYardage = desc.toGo <= 3;
  const depth = (shortYardage ? T.ai.coverDepthShort : T.ai.coverDepth) + (defCall === 'soft' ? T.ai.softDepthExtra : 0);
  const defSpots: [number, number][] = [
    [1, -1.8], [1, 0], [1, 1.8], // DL
    [4, -2.6], [4, 2.6], // LB
    [depth, -6.6], [depth, 6.6], // DB on the wideouts
    [depth + 3.5, 0], // Deep DB
  ];
  DEFENSE_SLOTS.forEach((slot, n) => {
    const [f, l] = defSpots[n];
    players.push(makePlayer(8 + n, def, rD[slot], cD[slot] ?? 1, xAt(f), lat(l), faceD));
  });

  const play = PLAYBOOK[desc.playbook] ?? PLAYBOOK[0];
  const assign = (idx: number, name: RouteName, outSign: number) => {
    const p = players[idx];
    if (name === 'block') { p.job = 'block'; return; }
    const r = buildRoute(name, p.x, p.y, dir, outSign);
    p.job = 'route'; p.route = r.pts; p.routeStop = r.stop; p.routeI = 0;
  };
  players[0].job = 'qb';
  players[1].job = 'mesh';
  if (play.rb !== 'block') {
    const side = players[1].y >= CY ? 1 : -1;
    const rr = buildRoute(play.rb, players[1].x, players[1].y, dir, side);
    players[1].route = rr.pts;
    players[1].routeStop = rr.stop;
  }
  assign(2, play.wr1, -dir);
  assign(3, play.wr2, dir);
  assign(4, play.te, dir);
  for (const i of [5, 6, 7]) players[i].job = 'block';

  // Defense: man coverage by default. The seeded call varies it.
  for (const i of [8, 9, 10]) players[i].job = 'rush';
  const cover = (i: number, target: number) => { players[i].job = 'cover'; players[i].target = target; };
  cover(13, 2); cover(14, 3);
  cover(11, 4);
  if (defCall === 'blitz') { players[12].job = 'rush'; cover(15, 1); }
  else { cover(12, 1); players[15].job = 'deep'; }
  if (play.te === 'block') { players[11].job = 'zone'; players[11].ax = players[11].x; players[11].ay = players[11].y; }

  const qbR = rO[0];
  const ball = emptyBall(players[0].x, players[0].y);
  ball.holder = 0;
  const armFatigue = teams.armFatigue[off] ?? 0;
  return {
    ...base,
    players, ball, defCall,
    armRange: armRange(qbR.attrs.arm) * (1 - armFatigue),
    qbAcc: qbR.attrs.acc,
    qbArmFatigue: armFatigue,
  };
}
