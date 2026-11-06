// One 60 Hz tick of the play simulation.
import { T } from './tuning';
import { checkContact, updateChaser, updateLoose } from './contact';
import { kickTap, updateKickFlight, updateKickMeter, updateKickPlayer } from './kick';
import { release, startAim, updateFlight } from './pass';
import { applySwipe, doQbRun, meshHandoff, startSneak, updateCarrier, updateFake } from './run';
import { releaseForScreen, updateBlocker, updatePath, updateRelease, updateStalk } from './ai/blocking';
import { biteOnFake, updateCover, updateCrash, updateDeep, updateZone } from './ai/coverage';
import { PLAYBOOK } from '../data/playbook';
import { moveTo, stopMoving } from './ai/move';
import { updatePursuit } from './ai/pursuit';
import { updateRoute } from './ai/routes';
import { updateRush } from './ai/rush';
import { A, EV, type SimInput, type SimPlayer, type SimState } from './state';

export const DT = 1 / T.hz;

const isDead = (s: SimState): boolean => s.phase === 'dead';

function applyInput(s: SimState, inp: SimInput): void {
  switch (inp.k) {
    case 'snap':
      if (s.phase === 'pre') snap(s);
      else if (s.phase === 'kickPower') kickTap(s, true);
      break;
    case 'aimStart': startAim(s); break;
    case 'aim': if (s.aim.on) { s.aim.dx = inp.dx; s.aim.dy = inp.dy; } break;
    case 'bullet': if (s.aim.on && s.cfg.bullet) s.aim.bullet = true; break;
    case 'throw': if (s.phase === 'pocket') release(s); break;
    case 'aimCancel': s.aim.on = false; break;
    case 'qbRun': doQbRun(s); break;
    case 'swipe': applySwipe(s, inp.dx, inp.dy); break;
    case 'truck': {
      if (s.phase === 'run' && s.cfg.trucking && s.ball.holder >= 0 && s.players[s.ball.holder].seat === s.control) s.g.truck = inp.on;
      else if (!inp.on) s.g.truck = false;
      break;
    }
    case 'tap':
      if (s.phase === 'kickPower' || s.phase === 'kickAim' || s.phase === 'kickFlight') { kickTap(s); break; }
      if (s.phase === 'run' && s.ezWait > 0 && s.players[s.ball.holder]?.seat === s.control) { s.ezWait = 0; s.ezRanOut = true; s.g.lastGestureAt = s.t; }
      break;
    default: break;
  }
}

export function snap(s: SimState): void {
  s.phase = 'pocket';
  s.phaseT = 0;
  s.snapT = s.t;
  s.clockRun = true;
  s.ev |= EV.snap;
}

function updateQb(s: SimState, p: SimPlayer, dt: number): void {
  const dir = s.desc.dir;
  if (s.phase === 'pocket' && s.ball.holder === p.i) {
    const m = s.mesh;
    if (PLAYBOOK[s.desc.playbook]?.kind === 'sneak') { startSneak(s); return; }
    if (m && !m.done) {
      // Turn and meet the back. The ball goes over once he's there, or a beat late if he isn't.
      moveTo(p, m.qx, m.qy, T.speed.dropBackSpeed * 1.15, dt);
      p.anim = Math.hypot(p.vx, p.vy) > 0.4 ? A.dropBack : A.stance;
      p.face = dir;
      s.ball.x = p.x; s.ball.y = p.y; s.ball.z = 1.1;
      const rb = s.players[1];
      const met = Math.hypot(rb.x - m.x, rb.y - m.y) <= T.play.meshReach;
      if (s.phaseT >= m.due && (met || s.phaseT >= m.due + T.play.meshLate)) meshHandoff(s);
      return;
    }
    const backX = s.desc.los - dir * (3 + T.pocket.dropDepth);
    const clampedX = Math.max(0.5, Math.min(T.field.len - 0.5, backX));
    if (Math.abs(p.x - clampedX) > 0.2) { moveTo(p, clampedX, p.y, T.speed.dropBackSpeed, dt); if (p.anim !== A.handoff || s.phaseT > (m?.due ?? 0) + 0.3) p.anim = A.dropBack; }
    else { stopMoving(p, dt); p.anim = s.aim.on ? A.aim : A.stance; }
    p.face = dir;
    s.ball.x = p.x; s.ball.y = p.y; s.ball.z = 1.2;
  } else {
    stopMoving(p, dt);
    if (p.anim !== A.throw || s.phaseT > 0.35) p.anim = A.stance;
  }
}

/** The back before he has a job: on his way to the mesh, or checking for a blitz before he releases. */
function updateMesh(s: SimState, p: SimPlayer, dt: number): void {
  const m = s.mesh;
  if (m && !m.done) {
    const rt = p.route;
    if (!rt || s.phaseT < m.due - T.play.meshLead) { stopMoving(p, dt); p.anim = A.stance; return; }
    if (p.routeI <= m.ri) {
      moveTo(p, rt[p.routeI], rt[p.routeI + 1], p.top, dt);
      if (Math.hypot(rt[p.routeI] - p.x, rt[p.routeI + 1] - p.y) < (p.routeI === m.ri ? 0.25 : 0.6)) p.routeI += 2;
      p.anim = A.run;
      p.face = p.vx >= 0 ? 1 : -1;
    } else { stopMoving(p, dt); p.anim = A.stance; }
    return;
  }
  const screen = PLAYBOOK[s.desc.playbook]?.kind === 'screen';
  if (s.phaseT < (screen ? T.play.screenSell : T.play.rbRelease)) { stopMoving(p, dt); p.anim = screen ? A.block : A.stance; return; }
  p.job = p.route ? 'route' : 'block';
}

function updatePlayer(s: SimState, p: SimPlayer, dt: number): void {
  if (p.stun > 0) {
    p.stun -= dt;
    stopMoving(p, dt);
    if (p.stun <= 0) p.anim = A.getUp;
    return;
  }
  if (biteOnFake(s, p, dt)) return;
  switch (p.job) {
    case 'qb': updateQb(s, p, dt); break;
    case 'mesh': if (s.phase === 'pre') { stopMoving(p, dt); p.anim = A.stance; } else updateMesh(s, p, dt); break;
    case 'path': updatePath(s, p, dt); break;
    case 'stalk': updateStalk(s, p, dt); break;
    case 'release': updateRelease(s, p, dt); break;
    case 'fake': updateFake(s, p, dt); break;
    case 'crash': if (s.phase === 'pocket') updateCrash(s, p, dt); else updatePursuit(s, p, dt); break;
    case 'route': updateRoute(s, p, dt); break;
    case 'block': updateBlocker(s, p, dt); break;
    case 'rush': if (s.phase === 'pocket') updateRush(s, p, dt); else updatePursuit(s, p, dt); break;
    case 'cover': updateCover(s, p, dt); break;
    case 'deep': updateDeep(s, p, dt); break;
    case 'zone': updateZone(s, p, dt); break;
    case 'carry': updateCarrier(s, p, dt); break;
    case 'lead': updateBlocker(s, p, dt); break;
    case 'pursue': updatePursuit(s, p, dt); break;
    case 'chase': updateChaser(s, p, dt); break;
    case 'kicker': case 'kickCover': case 'return': updateKickPlayer(s, p, dt); break;
    default: stopMoving(p, dt); p.anim = A.stance;
  }
}

function separate(s: SimState): void {
  const min = T.ai.separate;
  const n = s.players.length;
  for (let i = 0; i < n; i++) {
    const a = s.players[i];
    for (let j = i + 1; j < n; j++) {
      const b = s.players[j];
      if (a.seat !== b.seat || i === s.ball.holder || j === s.ball.holder) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      b.x += (dx / d) * push; b.y += (dy / d) * push;
    }
  }
}

export function step(s: SimState, inputs: readonly SimInput[] = []): void {
  if (s.finished) return;
  if (s.frozen) return;
  const dt = DT;
  s.tick += 1;
  s.t += dt;
  s.phaseT += dt;
  for (const inp of inputs) applyInput(s, inp);
  if (s.clockRun) s.clock = Math.max(0, s.clock - dt);

  if (s.phase === 'dead') {
    s.deadT += dt;
    for (const p of s.players) {
      p.vx *= 0.85; p.vy *= 0.85;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    if (s.deadT >= T.play.deadHold) s.finished = true;
    return;
  }
  if (s.phase === 'pre') return;
  if (s.phase === 'kickPower' || s.phase === 'kickAim') updateKickMeter(s, dt);
  else if (s.phase === 'kickFlight') updateKickFlight(s, dt);
  if (isDead(s)) return;

  if (s.phase === 'flight') updateFlight(s, dt);
  else if (s.phase === 'loose') updateLoose(s, dt);
  if (s.frozen) return;
  releaseForScreen(s);
  for (const p of s.players) {
    if (isDead(s) || s.frozen) return;
    updatePlayer(s, p, dt);
  }
  if (isDead(s)) return;
  separate(s);
  checkContact(s, dt);
}
