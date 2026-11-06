// A bot that plays through the same inputs a person uses. Runs in balance tests and in browsers with ?bot=1.
import { isRunKind, PLAYBOOK } from '../data/playbook';
import { rnd, type HasRng } from './rng';
import { T } from './tuning';
import { dirOf, type SimInput, type SimPlayer, type SimState } from './state';

export interface BotState extends HasRng {
  playId: number; plan: 'pass' | 'run' | 'qb'; holdUntil: number; snapDelay: number; aimT: number; target: number; kickDelay: number;
  aimTarget: number;
  /** Set true to skip all gestures, leaving the runner to the auto-runner. */
  passive: boolean;
}

export function newBot(seed: number): BotState {
  return { rng: seed, playId: -1, plan: 'pass', holdUntil: 0, snapDelay: 0, aimT: -1, target: -1, kickDelay: 0, passive: false, aimTarget: 99 };
}

function resetForPlay(b: BotState, s: SimState): void {
  const B = T.bot;
  b.playId = s.desc.id;
  const r = rnd(b);
  const play = PLAYBOOK[s.desc.playbook] ?? PLAYBOOK[0];
  // The call decides: a designed run hands off by itself, and a pass is held as long as its routes need.
  b.plan = isRunKind(play.kind) ? 'run' : r < B.qbRunChance ? 'qb' : 'pass';
  const [lo, hi] = play.kind === 'screen' ? (play.rb === 'screen' ? [B.holdScreenLo, B.holdScreenHi] : [B.holdBubbleLo, B.holdBubbleHi])
    : play.cat === 'short' ? [B.holdShortLo, B.holdShortHi]
    : play.kind === 'pa' ? [B.holdPaLo, B.holdPaHi]
    : [B.holdLo, B.holdHi];
  b.holdUntil = lo + (hi - lo) * rnd(b);
  b.snapDelay = rnd(b) * 0.4;
  b.aimT = -1;
  b.target = -1;
  b.kickDelay = 0.1 + rnd(b) * 0.3;
  b.aimTarget = 99;
}

/** Where a receiver will be `t` seconds from now, following their route. */
export function predictReceiver(p: SimPlayer, t: number, dir: 1 | -1 = 1): { x: number; y: number } {
  let x = p.x;
  let y = p.y;
  let vx = p.vx;
  let vy = p.vy;
  let left = t;
  const speed = p.top;
  const r = p.route;
  if (r) {
    for (let i = p.routeI; i < r.length && left > 0; i += 2) {
      const dx = r[i] - x;
      const dy = r[i + 1] - y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const need = d / speed;
      vx = (dx / d) * speed;
      vy = (dy / d) * speed;
      if (need <= left) { x = r[i]; y = r[i + 1]; left -= need; }
      else { x += vx * left; y += vy * left; left = 0; }
    }
  }
  if (left > 0 && !p.routeStop && Math.hypot(vx, vy) > 0.5) {
    // Past the end of the route, in short steps with the same turn rate and sideline rule as the route AI.
    const lo = T.field.routeRoom;
    const hi = T.field.width - T.field.routeRoom;
    for (let guard = 0; left > 1e-6 && guard < 80; guard++) {
      const h = Math.min(0.05, left);
      const n = Math.hypot(vx, vy) || 1;
      let ux = vx / n;
      let uy = vy / n;
      if (y < lo && uy < 0) uy = 0;
      if (y > hi && uy > 0) uy = 0;
      if (ux * dir < 0) ux = 0;
      if (Math.abs(uy) < 0.2 && Math.abs(ux) < 0.2) { ux = dir; uy = 0; }
      const m = Math.hypot(ux, uy) || 1;
      const ax = (ux / m) * speed - vx;
      const ay = (uy / m) * speed - vy;
      const an = Math.hypot(ax, ay);
      const max = T.speed.accel * h;
      if (an > max) { vx += (ax / an) * max; vy += (ay / an) * max; } else { vx += ax; vy += ay; }
      x += vx * h;
      y += vy * h;
      left -= h;
    }
    // The route AI turns them before they get far past their room.
    y = Math.max(lo - 0.6, Math.min(hi + 0.6, y));
  }
  return { x, y: Math.max(0.3, Math.min(T.field.width - 0.3, y)) };
}

/** Picks the most open receiver and returns the aim point that leads them. */
function chooseThrow(s: SimState, b: BotState): { dx: number; dy: number; openness: number } | null {
  const qb = s.players[0];
  const dir = s.desc.dir;
  let best: { dx: number; dy: number; openness: number } | null = null;
  let bestScore = -1e9;
  const B = T.bot;
  for (const p of s.players) {
    if (p.seat !== qb.seat || p.job !== 'route') continue;
    let t = Math.hypot(p.x - qb.x, p.y - qb.y) / T.pass.speed;
    let fx = p.x;
    let fy = p.y;
    for (let i = 0; i < 3; i++) {
      const f = predictReceiver(p, t, dir);
      fx = f.x; fy = f.y;
      t = Math.hypot(fx - qb.x, fy - qb.y) / T.pass.speed;
    }
    const dist = Math.hypot(fx - qb.x, fy - qb.y);
    if (dist > s.armRange) continue;
    let open = 99;
    for (const d of s.players) {
      if (d.seat === qb.seat || d.stun > 0) continue;
      const dd = Math.hypot(d.x + d.vx * t * 0.6 - fx, d.y + d.vy * t * 0.6 - fy);
      if (dd < open) open = dd;
    }
    const gain = (fx - s.desc.los) * dir;
    const need = Math.max(1, Math.min(s.desc.toGo, B.needCap));
    // Like most players, it looks for an open man near the sticks rather than a bomb.
    const value = gain <= need ? gain * B.valueShort : need * B.valueShort - (gain - need) * B.valueDeep;
    const score = Math.min(open, 6) * B.valueOpen + value + rnd(b) * 1.5;
    if (score > bestScore) { bestScore = score; best = { dx: fx - qb.x, dy: fy - qb.y, openness: open }; }
  }
  return best;
}

export function botInputs(s: SimState, b: BotState, seat: number): SimInput[] {
  if (s.frozen || s.finished) return [];
  if (b.playId !== s.desc.id) resetForPlay(b, s);
  const out: SimInput[] = [];
  const B = T.bot;
  switch (s.phase) {
    case 'pre':
      if (s.control === seat && s.t >= b.snapDelay) out.push({ k: 'snap' });
      break;
    case 'pocket': {
      if (s.control !== seat || s.ball.holder !== 0) break;
      if (b.plan === 'run') break;
      if (b.plan === 'qb' && s.phaseT >= 0.9) { out.push({ k: 'qbRun' }); break; }
      const qb = s.players[0];
      let pressure = 99;
      for (const d of s.players) if (d.seat !== qb.seat && d.engaged < 0) pressure = Math.min(pressure, Math.hypot(d.x - qb.x, d.y - qb.y));
      if (b.aimT < 0 && (s.phaseT >= b.holdUntil || (pressure < B.panicRange && rnd(b) < B.panicChance))) {
        out.push({ k: 'aimStart' });
        b.aimT = s.t;
      } else if (b.aimT >= 0) {
        const c = chooseThrow(s, b);
        if (c) {
          const err = B.aimErrorYards;
          out.push({ k: 'aim', dx: c.dx + (rnd(b) * 2 - 1) * err, dy: c.dy + (rnd(b) * 2 - 1) * err });
          if (s.t - b.aimT >= T.pocket.aimMinHold + 0.02) out.push({ k: 'throw' });
        } else if (s.t - b.aimT > 0.5) {
          out.push({ k: 'aim', dx: s.desc.dir * 12, dy: 0 });
          out.push({ k: 'throw' });
        }
      }
      break;
    }
    case 'run': {
      const h = s.ball.holder;
      if (h < 0) break;
      const p = s.players[h];
      if (p.seat !== seat || s.control !== seat) break;
      if (s.ezWait > 0) {
        // Run it out only with room to spare.
        const near = s.players.some((d) => d.seat !== p.seat && Math.hypot(d.x - p.x, d.y - p.y) < 8);
        if (!near && rnd(b) < 0.1) out.push({ k: 'tap' });
        break;
      }
      // A sneak is a push into the pile: no moves until he's through it.
      if (b.passive || s.g.sneakPush) break;
      const dir = dirOf(s, p.seat);
      for (const d of s.players) {
        if (d.seat === p.seat || d.stun > 0 || d.engaged >= 0) continue;
        const ahead = (d.x - p.x) * dir;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (ahead > 0 && dist < B.jukeRange && rnd(b) < B.swipeChance) {
          if (dist < T.run.stiffRange && s.g.stiffsLeft > 0) out.push({ k: 'swipe', dx: d.x - p.x, dy: d.y - p.y });
          else out.push({ k: 'swipe', dx: 0, dy: d.y >= p.y ? -30 : 30 });
          break;
        }
      }
      break;
    }
    case 'kickPower': {
      if (s.control !== seat || !s.kick) break;
      const k = s.kick;
      const mid = (T.kick.greenLo + T.kick.greenHi) / 2;
      if (s.t >= b.kickDelay && Math.abs(k.meter - mid) <= B.kickMeterSlop) out.push({ k: 'tap' });
      break;
    }
    case 'kickAim': {
      if (s.control !== seat || !s.kick) break;
      if (b.aimTarget === 99) b.aimTarget = (rnd(b) * 2 - 1) * B.kickAimSlop;
      if (Math.abs(s.kick.arrow - b.aimTarget) <= 0.05) out.push({ k: 'tap' });
      break;
    }
    default:
      break;
  }
  return out;
}
