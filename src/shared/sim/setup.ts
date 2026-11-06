// Builds the starting state of a play: the formation, everyone's job, and the defense's alignment for its call.
import { armRange, DEFENSE_SLOTS, OFFENSE_SLOTS, topSpeed, type RosterPlayer } from '../data/roster';
import { DEF_CALLS, FORMATIONS, OL_SPOTS, PLAYBOOK, ROUTES, type Assign, type Formation, type Play, type RouteName, type Spot } from '../data/playbook';
import { createKick } from './kick';
import { T } from './tuning';
import { emptyStats, type BallState, type MeshState, type PlayDesc, type Seat, type SimCfg, type SimPlayer, type SimState, type SimTeams } from './state';

const CY = T.field.center;

export function makePlayer(i: number, seat: Seat, r: RosterPlayer, cond: number, x: number, y: number, face: 1 | -1): SimPlayer {
  const a = r.attrs;
  return {
    i, seat, role: r.role, slot: r.slot, x, y, vx: 0, vy: 0, face, anim: 0,
    top: topSpeed(a.spd, r.role), str: a.str, tck: a.tck, cat: a.cat, blk: a.blk, sta: a.sta, cond,
    job: 'idle', target: -1, engaged: -1, shed: 0, route: null, routeI: 0, routeStop: false,
    stun: 0, tackleCd: 0, ran: 0, ax: 0, ay: 0, freeUntil: 0, zone: null, jam: 0,
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
    g: { jukeT: 0, jukeDir: 0, lastJukeAt: -9, jukeLoss: 0, stiffT: 0, stiffsLeft: 0, diveT: 0, diveGain: 0, sneakPush: false, slowT: 0, truck: false, truckMeter: 0, hitSlowT: 0, lastGestureAt: -9, ballT: 0 },
    defCall: desc.defense ?? 0, mesh: null,
    handoff: null, frozen: false, autoRun: false, ezImpetus: false, ezWait: 0, ezRanOut: false, scrambled: false, ran: false,
    force: '', forceRecover: -1, ev: 0, result: null, deadT: 0, finished: false,
    stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, catchX: 0, note: '',
  };
}

export function emptyBall(x: number, y: number): BallState {
  return { x, y, z: 0.6, holder: -1, sx: x, sy: y, ex: x, ey: y, t: 0, dur: 0, peak: 0, startZ: 0, endZ: 0, vx: 0, vy: 0, bounce: 0 };
}

const clampX = (x: number) => Math.max(0.5, Math.min(T.field.len - 0.5, x));
const clampY = (y: number) => Math.max(T.field.routeRoom, Math.min(T.field.width - T.field.routeRoom, y));

/** Converts a route's [forward, out] offsets into absolute waypoints. */
function buildRoute(name: RouteName, x: number, y: number, dir: number, outSign: number): { pts: number[]; stop: boolean } {
  const def = ROUTES[name];
  const pts: number[] = [];
  for (const [f, o] of def.pts) pts.push(clampX(x + dir * f), clampY(y + outSign * o));
  return { pts, stop: def.stop };
}

/** The play for a description, defaulting to the first one. */
export function playOf(s: { desc: PlayDesc }): Play { return PLAYBOOK[s.desc.playbook] ?? PLAYBOOK[0]; }

const sideOf = (l: number, fallback: 1 | -1): 1 | -1 => (l > 0.2 ? 1 : l < -0.2 ? -1 : fallback);

/** Formation spots for the eight on offense, in slot order: QB, RB, WR, WR, TE, then the line. */
export function formationSpots(f: Formation): Spot[] { return [f.qb, f.rb, f.wr1, f.wr2, f.te, ...OL_SPOTS]; }

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
  const play = PLAYBOOK[desc.playbook] ?? PLAYBOOK[0];
  const call = DEF_CALLS[desc.defense] ?? DEF_CALLS[0];
  const form = FORMATIONS[play.formation];
  // Laterals are mirrored with direction, so receivers swap sides at a change of ends.
  const lat = (l: number) => clampY(CY + l * dir);
  const xAt = (f: number) => clampX(los + dir * f);
  const faceO = (dir > 0 ? 1 : -1) as 1 | -1;
  const faceD = (-faceO) as 1 | -1;

  const offSpots = formationSpots(form);
  const players: SimPlayer[] = OFFENSE_SLOTS.map((slot, n) => {
    const [f, l] = offSpots[n];
    return makePlayer(n, off, rO[slot], cO[slot] ?? 1, xAt(f), lat(l), faceO);
  });

  const assign = (idx: number, a: Assign, fallback: 1 | -1) => {
    const p = players[idx];
    const side = sideOf(offSpots[idx][1], fallback);
    if (a === 'block') { p.job = 'block'; return; }
    if (a === 'stalk') { p.job = 'stalk'; return; }
    if (a === 'lead') {
      const hole = play.run?.hole ?? 0;
      p.job = 'path';
      p.route = [xAt(-1), lat(hole * 0.8), xAt(1.5), lat(hole)];
      return;
    }
    const r = buildRoute(a, p.x, p.y, dir, side * dir);
    p.job = 'route'; p.route = r.pts; p.routeStop = r.stop; p.routeI = 0;
  };
  players[0].job = 'qb';
  assign(2, play.wr1, -1);
  assign(3, play.wr2, 1);
  assign(4, play.te, play.teSide);
  for (const i of [5, 6, 7]) players[i].job = 'block';

  // The back: a route after his blitz check, a block, or the run's path through the mesh.
  const rb = players[1];
  let mesh: MeshState | null = null;
  if (play.run && (play.kind === 'run' || play.kind === 'pa')) {
    mesh = buildMesh(play, form, rb, xAt, lat);
    rb.job = 'mesh';
  } else if (play.rb === 'block') {
    rb.job = 'block';
  } else {
    rb.job = 'mesh';
    const r = buildRoute(play.rb as RouteName, rb.x, rb.y, dir, sideOf(form.rb[1], play.rbSide) * dir);
    rb.route = r.pts; rb.routeStop = r.stop;
  }
  // Power and counter: the backside lineman pulls through the hole.
  if (play.run?.pull && play.kind === 'run') {
    const hole = play.run.hole;
    const g = players[hole > 0 ? 5 : 7];
    const [, l0] = offSpots[g.i];
    g.job = 'path';
    g.route = [xAt(-1.8), lat(l0 * 0.6), xAt(-1.3), lat(hole * 0.7), xAt(1.2), lat(hole)];
  }

  // Defense.
  const short = desc.toGo <= 3;
  const cushion = short ? T.ai.coverDepthShort : T.ai.coverDepth;
  const widest = (side: 1 | -1): number => {
    let w = 6.6 * side;
    for (const n of [1, 2, 3, 4]) { const l = offSpots[n][1]; if (Math.sign(l) === side && Math.abs(l) > Math.abs(w)) w = l; }
    return w;
  };
  const dlSpots: Spot[] = [[1, -1.8], [1, 0], [1, 1.8]];
  call.jobs.forEach((job, n) => {
    const isDL = n < 3;
    const isLB = n === 3 || n === 4;
    const isCB = n === 5 || n === 6;
    const side: 1 | -1 = n === 3 || n === 5 || (isDL && n === 0) ? -1 : 1;
    let spot: Spot;
    if (isDL) spot = dlSpots[n];
    else if (job.k === 'man') {
      const [, ml] = offSpots[job.on];
      const inside = ml > 0.2 ? -0.5 : ml < -0.2 ? 0.5 : 0;
      const depth = isCB ? (call.press ? T.ai.pressDepth : cushion) : isLB ? (short ? 3.5 : 4) : 5.5;
      spot = [depth, ml + inside];
    } else if (job.k === 'rush') spot = [T.ai.blitzDepth, side * 2.2];
    else if (job.k === 'crash') spot = [3.5, side * 1.6];
    else if (job.k === 'deep') spot = [cushion + 3.5, 0];
    else if (isCB) spot = [job.z.deep ? (short ? 5 : 7) : 5, widest(side) - side * 0.5];
    else if (isLB) spot = [Math.min(5, job.z.at[0]), job.z.at[1] * 0.75];
    else spot = [Math.min(12, job.z.at[0]), job.z.at[1]];
    const slot = DEFENSE_SLOTS[n];
    const p = makePlayer(8 + n, def, rD[slot], cD[slot] ?? 1, xAt(spot[0]), lat(spot[1]), faceD);
    p.ax = p.x; p.ay = p.y;
    switch (job.k) {
      case 'rush': p.job = 'rush'; break;
      case 'deep': p.job = 'deep'; break;
      case 'crash': p.job = 'crash'; break;
      case 'man': p.job = 'cover'; p.target = job.on; break;
      case 'zone': {
        const z = job.z;
        p.job = 'zone';
        p.zone = { x: xAt(z.at[0]), y: lat(z.at[1]), hw: z.hw, d0: z.d0, d1: z.d1, deep: z.deep };
        break;
      }
    }
    players.push(p);
  });
  // Press: a corner jams his man, and the stronger of the two decides for how long.
  if (call.press) {
    for (const d of players) {
      if (d.job !== 'cover' || (d.i !== 13 && d.i !== 14)) continue;
      const wr = players[d.target];
      if (wr.role !== 'WR' || wr.job !== 'route') continue;
      wr.jam = Math.max(0.15, T.ai.pressJam * (1 + 0.08 * (d.str - wr.str)));
    }
  }

  const qbR = rO[0];
  const ball = emptyBall(players[0].x, players[0].y);
  ball.holder = 0;
  const armFatigue = teams.armFatigue[off] ?? 0;
  return {
    ...base,
    players, ball, mesh,
    armRange: armRange(qbR.attrs.arm) * (1 - armFatigue),
    qbAcc: qbR.attrs.acc,
    qbArmFatigue: armFatigue,
  };
}

/** The run's path: an optional false step, the mesh with the QB, then up through the hole. */
function buildMesh(play: Play, form: Formation, rb: SimPlayer, xAt: (f: number) => number, lat: (l: number) => number): MeshState {
  const run = play.run!;
  const holeSide = sideOf(run.hole, play.rbSide);
  const rbSide = sideOf(form.rb[1], holeSide);
  const draw = run.mesh >= 0.9;
  let mf: number;
  let ml: number;
  if (draw) { mf = -(3 + T.pocket.dropDepth) + 0.2; ml = 0.7 * rbSide; }
  else if (form.gun) { mf = form.qb[0] + 0.2; ml = 0.7 * rbSide; }
  else { mf = -2.6 - Math.min(0.6, Math.abs(run.hole) * 0.08); ml = 0.7 * holeSide; }
  const pts: number[] = [];
  if (run.fake !== undefined) pts.push(xAt(form.rb[0] + 0.6), lat(run.fake));
  const ri = pts.length;
  pts.push(xAt(mf), lat(ml));
  pts.push(xAt(-1.2), lat(run.hole * 0.8), xAt(1), lat(run.hole), xAt(3), lat(run.hole * 1.03));
  rb.route = pts;
  rb.routeI = 0;
  rb.routeStop = false;
  const qSide = ml === 0 ? -holeSide : -Math.sign(ml);
  return { x: pts[ri], y: pts[ri + 1], qx: pts[ri], qy: lat(ml + qSide * 0.6), ri, due: run.mesh, done: false };
}
