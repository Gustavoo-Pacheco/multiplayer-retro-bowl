// Tackles and their odds. The formulas are exported, so tests can check them directly.
import { rnd } from './rng';
import { T } from './tuning';
import { A, EV, type SimPlayer, type SimState } from './state';
import { endPlay } from './end';

export function clampChance(p: number): number { return Math.max(T.chance.min, Math.min(T.chance.max, p)); }

export type HitAngle = 'behind' | 'front' | 'side';

export function tackleChance(tackling: number, strength: number, from: HitAngle, stiff: boolean, truck: boolean): number {
  const c = T.contact;
  let p = c.tackleBase + c.tacklePerAttr * (tackling - strength);
  if (from === 'behind') p += c.behind;
  if (from === 'front') p += c.headOn;
  if (stiff) p += c.stiff;
  if (truck && from === 'front') p += c.truckFront;
  if (truck && from === 'behind') p += c.truckBehind;
  return clampChance(p);
}

export function hitAngle(r: SimPlayer, d: SimPlayer, dirSign: number): HitAngle {
  const sp = Math.hypot(r.vx, r.vy);
  const ux = sp > 0.5 ? r.vx / sp : dirSign;
  const uy = sp > 0.5 ? r.vy / sp : 0;
  const dx = d.x - r.x;
  const dy = d.y - r.y;
  const n = Math.hypot(dx, dy) || 1;
  const dot = (dx * ux + dy * uy) / n;
  if (dot > 0.5) return 'front';
  if (dot < -0.5) return 'behind';
  return 'side';
}

/** Checks defenders against the ball holder. Returns true if a tackle ended the play. */
export function checkContact(s: SimState, dt: number): boolean {
  const hIdx = s.ball.holder;
  if (hIdx < 0) return false;
  const r = s.players[hIdx];
  const dirSign = r.seat === s.desc.offense ? s.desc.dir : -s.desc.dir;
  for (const d of s.players) {
    if (d.tackleCd > 0) d.tackleCd -= dt;
    if (d.seat === r.seat || d.stun > 0 || d.engaged >= 0 || d.tackleCd > 0) continue;
    const dist = Math.hypot(d.x - r.x, d.y - r.y);
    if (dist > T.contact.radius) continue;
    const from = hitAngle(r, d, dirSign);
    const stiff = s.g.stiffT > 0;
    const truck = s.g.truck && s.cfg.trucking;
    const p = tackleChance(d.tck, r.str, from, stiff, truck);
    s.ev |= EV.grunt;
    if (rnd(s) < p) {
      s.ev |= EV.tackle;
      const n = dist || 1;
      const ux = (r.x - d.x) / n;
      const fall = from === 'behind' ? T.contact.fallForward * dirSign : ux * T.contact.knockback;
      r.x += fall;
      d.anim = A.tackle;
      d.vx = d.vy = 0;
      d.stun = 9;
      r.anim = s.phase === 'pocket' ? A.sacked : A.tackled;
      endPlay(s, 'tackle');
      return true;
    }
    d.stun = T.contact.missStun;
    d.tackleCd = T.contact.retryCd;
    d.anim = A.tackle;
    s.g.hitSlowT = T.contact.hitSlowTime;
  }
  return false;
}
