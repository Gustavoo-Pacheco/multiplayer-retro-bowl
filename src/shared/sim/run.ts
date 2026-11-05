// The ball carrier: moves forward automatically.
import { T } from './tuning';
import { endPlay } from './end';
import { A, dirOf, inOppEndZone, type SimPlayer, type SimState } from './state';

export function beginRun(s: SimState): void {
  s.phase = 'run';
  s.phaseT = 0;
  const h = s.ball.holder;
  for (const p of s.players) {
    if (p.i === h) p.job = 'carry';
    else if (p.seat === s.possessor) { p.job = 'lead'; if (p.engaged < 0) p.target = -1; }
    else p.job = 'pursue';
  }
}

export function carrierSpeed(s: SimState, p: SimPlayer): number {
  const loss = T.speed.staminaLoss * Math.min(1, p.ran / (T.speed.staminaYards * (0.5 + p.sta / 10)));
  const cond = s.cfg.fatigue ? 1 - T.speed.conditionWeight * (1 - p.cond) : 1;
  let v = p.top * (1 - loss) * cond;
  if (s.g.hitSlowT > 0) v *= T.contact.hitSlowMult;
  return v;
}

export function updateCarrier(s: SimState, p: SimPlayer, dt: number): void {
  const dir = dirOf(s, p.seat);
  const v = carrierSpeed(s, p);
  s.g.hitSlowT = Math.max(0, s.g.hitSlowT - dt);
  const dvx = dir * v - p.vx;
  const max = T.speed.accel * dt;
  p.vx += Math.max(-max, Math.min(max, dvx));
  p.vy *= 0.8;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.ran += Math.abs(p.vx) * dt;
  p.face = dir;
  p.anim = A.runBall;
  s.ball.x = p.x;
  s.ball.y = p.y;
  s.ball.z = 1;
  if (inOppEndZone(p.x, dir)) { endPlay(s, 'td'); return; }
  if (p.y < -T.field.oobMargin || p.y > T.field.width + T.field.oobMargin) { endPlay(s, 'oob'); return; }
  if (p.x < 0 || p.x > T.field.len) endPlay(s, 'oob');
}
