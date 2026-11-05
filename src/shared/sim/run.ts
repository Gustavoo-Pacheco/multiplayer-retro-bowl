// The ball carrier: moves forward automatically, with gestures adding moves.
import { PLAYBOOK } from '../data/playbook';
import { rnd } from './rng';
import { T } from './tuning';
import { endPlay } from './end';
import { autoSteer } from './ai/autorun';
import { A, dirOf, EV, inOppEndZone, inOwnEndZone, type SimPlayer, type SimState } from './state';

export function beginRun(s: SimState): void {
  s.phase = 'run';
  s.phaseT = 0;
  const h = s.ball.holder;
  const g = s.g;
  g.lastGestureAt = s.t;
  g.ballT = s.t;
  g.jukeT = 0; g.stiffT = 0; g.diveT = 0; g.slowT = 0; g.truck = false; g.truckMeter = 0; g.jukeLoss = 0;
  if (h >= 0) g.stiffsLeft = Math.floor(s.players[h].str * T.run.stiffPerStrength);
  for (const p of s.players) {
    if (p.i === h) { p.job = 'carry'; if (p.engaged >= 0) { const e = s.players[p.engaged]; e.engaged = -1; p.engaged = -1; } }
    else if (p.seat === s.possessor) { p.job = 'lead'; if (p.engaged < 0) p.target = -1; }
    else p.job = 'pursue';
  }
}

/** The handoff: the RB takes the ball and follows the play's run lane. */
export function doHandoff(s: SimState): void {
  if (s.phase !== 'pocket' || s.ball.holder !== 0 || s.phaseT > T.pocket.handoffWindow) return;
  const rb = s.players[1];
  const qb = s.players[0];
  if (s.aim.on) s.aim.on = false;
  s.ball.holder = 1;
  s.ran = true;
  qb.anim = A.handoff;
  s.lastCarrier = rb.seat;
  beginRun(s);
  qb.job = 'lead';
  const play = PLAYBOOK[s.desc.playbook] ?? PLAYBOOK[0];
  const dir = s.desc.dir;
  const side = rb.y >= T.field.center ? 1 : -1;
  const laneY = play.lane === 'inside' ? T.field.center + side * 0.9 : T.field.center + side * 5.2;
  const clampX = (x: number) => Math.max(0.5, Math.min(T.field.len - 0.5, x));
  rb.route = [clampX(s.desc.los - dir * 1), laneY, clampX(s.desc.los + dir * 2), laneY];
  rb.routeI = 0;
  rb.routeStop = false;
  addTouch(s, rb);
}

export function doQbRun(s: SimState): void {
  if (s.phase !== 'pocket' || s.ball.holder !== 0) return;
  s.aim.on = false;
  s.scrambled = true;
  s.ran = true;
  beginRun(s);
  s.players[0].route = null;
  addTouch(s, s.players[0]);
}

export function addTouch(s: SimState, p: SimPlayer): void {
  const R = T.run;
  s.touches.push([p.seat, p.slot, -(R.condPerTouchLo + (R.condPerTouchHi - R.condPerTouchLo) * rnd(s))]);
}

/** A swipe from the player in control. Which move it makes depends on direction and nearby defenders. */
export function applySwipe(s: SimState, dx: number, dy: number): void {
  if (s.phase !== 'run' || s.ball.holder < 0) return;
  const p = s.players[s.ball.holder];
  if (p.seat !== s.control) return;
  const g = s.g;
  if (g.diveT > 0) return;
  const R = T.run;
  const n = Math.hypot(dx, dy);
  if (n < 1e-6) return;
  const ux = dx / n;
  const uy = dy / n;
  const dir = dirOf(s, p.seat);
  g.lastGestureAt = s.t;
  p.route = null;
  if (s.ezWait > 0) { s.ezWait = 0; s.ezRanOut = true; }
  // A stiff arm needs a defender within 2 yards, in the swipe's direction.
  if (g.stiffsLeft > 0) {
    for (const d of s.players) {
      if (d.seat === p.seat || d.stun > 0) continue;
      const ddx = d.x - p.x;
      const ddy = d.y - p.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist <= R.stiffRange && dist > 0 && (ddx * ux + ddy * uy) / dist >= R.stiffAngleCos) {
        g.stiffT = R.stiffTime;
        g.stiffsLeft -= 1;
        p.anim = A.stiff;
        s.ev |= EV.stiff;
        return;
      }
    }
  }
  if (Math.abs(uy) > Math.abs(ux)) {
    // A juke. Repeating one soon after the last cuts speed.
    g.jukeT = R.jukeTime;
    g.jukeDir = uy > 0 ? 1 : -1;
    if (s.t - g.lastJukeAt < R.jukeRepeatWindow) g.jukeLoss = Math.min(0.5, g.jukeLoss + R.jukeRepeatLoss);
    g.lastJukeAt = s.t;
    s.ev |= EV.juke;
  } else if (ux * dir > 0) {
    g.diveT = R.diveTime;
    g.diveGain = R.diveLo + (R.diveHi - R.diveLo) * rnd(s);
    s.ev |= EV.dive;
  } else {
    g.slowT = R.slowTime;
  }
}

export function carrierSpeed(s: SimState, p: SimPlayer): number {
  const loss = T.speed.staminaLoss * Math.min(1, p.ran / (T.speed.staminaYards * (0.5 + p.sta / 10)));
  const cond = s.cfg.fatigue ? 1 - T.speed.conditionWeight * (1 - p.cond) : 1;
  const g = s.g;
  let v = p.top * T.run.carryMult * (1 - loss) * cond * (1 - g.jukeLoss);
  if (g.hitSlowT > 0) v *= T.contact.hitSlowMult;
  if (g.slowT > 0) v *= T.run.slowMult;
  if (g.truck) v *= T.run.truckMult;
  return v;
}

export function updateCarrier(s: SimState, p: SimPlayer, dt: number): void {
  const dir = dirOf(s, p.seat);
  const g = s.g;
  const R = T.run;
  g.hitSlowT = Math.max(0, g.hitSlowT - dt);
  g.slowT = Math.max(0, g.slowT - dt);
  g.stiffT = Math.max(0, g.stiffT - dt);
  g.jukeLoss = Math.max(0, g.jukeLoss - (dt * R.jukeRepeatLoss) / R.jukeRecover);
  if (g.truck) g.truckMeter = Math.min(1, g.truckMeter + dt * R.truckFill); else g.truckMeter = 0;

  // Own end zone after a pick or a kick: slow to a stop unless the player runs it out.
  if (s.ezWait > 0) {
    s.ezWait -= dt;
    const autoGo = s.autoRun && !nearDefender(s, p, 6);
    if (autoGo) { s.ezWait = 0; s.ezRanOut = true; }
    else if (s.ezWait <= 0) {
      s.ezWait = 0;
      p.anim = A.kneel;
      endPlay(s, 'touchback');
      return;
    } else {
      p.vx *= 0.92; p.vy *= 0.9;
      p.x += p.vx * dt; p.y += p.vy * dt;
      s.ball.x = p.x; s.ball.y = p.y; s.ball.z = 1;
      p.anim = Math.abs(p.vx) > 1 ? A.runBall : A.stance;
      return;
    }
  }

  let vx: number;
  let vy: number;
  const v = carrierSpeed(s, p);
  if (g.diveT > 0) {
    g.diveT -= dt;
    vx = dir * (g.diveGain / R.diveTime);
    vy = 0;
    p.vx = vx; p.vy = vy;
    p.x += vx * dt;
    p.anim = A.dive;
    s.ball.x = p.x; s.ball.y = p.y; s.ball.z = 0.4;
    if (inOppEndZone(p.x, dir)) { endPlay(s, 'td'); return; }
    if (g.diveT <= 0) { p.anim = A.tackled; endPlay(s, 'tackle'); }
    return;
  }
  if (p.route && p.routeI < p.route.length) {
    // Following the run lane.
    const tx = p.route[p.routeI];
    const ty = p.route[p.routeI + 1];
    const dx = tx - p.x;
    const dy = ty - p.y;
    const n = Math.hypot(dx, dy);
    if (n < 0.6) p.routeI += 2;
    vx = n > 0 ? (dx / n) * v : dir * v;
    vy = n > 0 ? (dy / n) * v : 0;
  } else {
    vx = dir * v;
    vy = 0;
    const idle = s.autoRun || s.t - g.lastGestureAt > R.autoIdle;
    if (idle && g.jukeT <= 0) vy = autoSteer(s, p);
    if (g.jukeT > 0) {
      g.jukeT -= dt;
      vy = g.jukeDir * R.jukeSpeed;
      vx = dir * v * R.jukeForward;
    }
  }
  if (Math.abs(vy) > 0.01 && g.jukeT <= 0 && Math.abs(vx) > 0) {
    // Lateral steering doesn't add speed beyond the runner's top speed.
    const m = Math.hypot(vx, vy);
    if (m > v) { vx *= v / m; vy *= v / m; }
  }
  const max = T.speed.accel * dt * (g.jukeT > 0 ? 3 : 1);
  const ax = vx - p.vx;
  const ay = vy - p.vy;
  const am = Math.hypot(ax, ay);
  if (am > max) { p.vx += (ax / am) * max; p.vy += (ay / am) * max; } else { p.vx = vx; p.vy = vy; }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.ran += Math.hypot(p.vx, p.vy) * dt;
  if (Math.abs(p.vx) > 0.5) p.face = p.vx > 0 ? 1 : -1;
  if (g.stiffT > 0) p.anim = A.stiff;
  else if (g.truck) p.anim = A.truck;
  else if (g.jukeT > 0) p.anim = g.jukeDir < 0 ? A.jukeL : A.jukeR;
  else p.anim = p.job === 'qb' || s.scrambled ? A.scramble : A.runBall;
  s.ball.x = p.x;
  s.ball.y = p.y;
  s.ball.z = 1;
  if (s.ezImpetus && !inOwnEndZone(p.x, dir)) s.ezImpetus = false;
  if (inOppEndZone(p.x, dir)) { endPlay(s, 'td'); return; }
  if (p.y < -T.field.oobMargin || p.y > T.field.width + T.field.oobMargin) {
    endPlay(s, 'oob');
    return;
  }
  if (p.x < 0 || p.x > T.field.len) endPlay(s, 'oob');
}

function nearDefender(s: SimState, p: SimPlayer, range: number): boolean {
  return s.players.some((d) => d.seat !== p.seat && d.stun <= 0 && Math.hypot(d.x - p.x, d.y - p.y) < range);
}
