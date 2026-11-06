// The coach: suggests a play for each side, and calls the computer's defense.
// Pure and seeded, so the room server and both browsers agree on every suggestion.
import { DEF_CALLS, isRunKind, PLAYBOOK, type DefCall, type Play } from '../data/playbook';
import { mixSeed } from '../sim/rng';

export interface Situation {
  down: number;
  toGo: number;
  /** Yards from the ball to the goal line. */
  toGoal: number;
  clock: number;
  period: number;
  /** Offense score minus defense score. */
  lead: number;
  /** Inside the end-of-half hurry window. */
  hurry: boolean;
  twoPoint: boolean;
  /** The offense's recent calls, oldest first. */
  recent: number[];
}

const noise = (seed: number, id: number): number => (mixSeed(seed, id + 17) % 1000) / 1000;

const SIDELINE = new Set(['QUICK OUTS', 'FLOOD', 'STICK', 'CURL FLAT']);
const GOAL_LINE = new Set(['SLANTS', 'PA CROSSERS', 'MESH', 'STICK']);

/** What kind of call a play is, for the coach's weights. */
type Family = 'run' | 'sneak' | 'short' | 'deep' | 'pa' | 'screen';
const familyOf = (p: Play): Family => {
  if (p.kind === 'sneak') return 'sneak';
  if (isRunKind(p.kind)) return 'run';
  if (p.kind === 'screen') return 'screen';
  // A shot down the field is a deep call, play action or not.
  if (p.cat === 'deep' || p.gain[1] >= 25) return 'deep';
  return p.kind === 'pa' ? 'pa' : 'short';
};

/** How much each kind of call suits an early down, by yards to go. A real call sheet mixes them, so the weights are close. */
const EARLY: Record<'first' | 'long' | 'medium' | 'short', Record<Family, number>> = {
  first: { run: 0.95, sneak: -6, short: 0.85, deep: 0.65, pa: 0.9, screen: 0.8 },
  long: { run: 0.75, sneak: -6, short: 1.0, deep: 0.9, pa: 0.6, screen: 1.0 },
  medium: { run: 0.9, sneak: -6, short: 0.95, deep: 0.6, pa: 0.85, screen: 0.7 },
  short: { run: 1.15, sneak: 0.4, short: 0.75, deep: 0.5, pa: 1.0, screen: 0.3 },
};

/** How often each kind of call gets its yards at all: passes fall incomplete, runs rarely go nowhere. */
const COMPLETE: Record<Family, number> = { run: 0.95, sneak: 0.95, short: 0.72, deep: 0.5, pa: 0.6, screen: 0.8 };

/** How well each play suits the situation. Higher is better. */
export function offenseScore(p: Play, s: Situation): number {
  const need = s.twoPoint ? s.toGoal : Math.max(0.5, Math.min(s.toGo, s.toGoal));
  const [lo, hi] = p.gain;
  const fam = familyOf(p);
  const run = fam === 'run' || fam === 'sneak';
  // The chance the play gains `yards`, if its gains were spread evenly over its range and a pass can fall incomplete.
  const reach = (yards: number) => Math.max(0, Math.min(1, (hi - yards) / Math.max(1, hi - lo))) * COMPLETE[fam];
  let v: number;
  if (s.down >= 3 || s.twoPoint) {
    // A must-have down: make the line, without a long-developing gamble when it's short.
    v = 3 * reach(need);
    if (run && need > 3 && p.name !== 'HB DRAW') v -= 2;
    if (fam === 'deep' && need < 8) v -= 0.6;
    if (fam === 'short') v += 0.3;
    if (fam === 'sneak') v += need <= 1.2 ? 1 : -6;
  } else {
    // An early down: stay on schedule with a mix of everything.
    const band = s.down === 1 && need >= 7 ? 'first' : need >= 7 ? 'long' : need >= 3 ? 'medium' : 'short';
    // Staying on schedule: about four yards on first down, more than half the rest on second.
    const target = s.down === 1 ? Math.min(need, 4) : Math.min(need, Math.max(3, need * 0.6));
    v = EARLY[band][fam] + 0.8 * reach(target);
    if (fam === 'sneak' && need > 1.2) v = -6;
  }
  if (s.toGoal <= 12 && fam === 'deep' && lo >= s.toGoal) v -= 1.2;
  if (s.toGoal <= 4) { if (run) v += 0.6; if (GOAL_LINE.has(p.name)) v += 0.5; if (p.formation === 'heavy') v += 0.4; }
  if (s.hurry && s.lead <= 0) { if (run) v -= 2.5; if (SIDELINE.has(p.name)) v += 1.2; }
  if (s.period >= 4 && s.lead > 0 && s.clock <= 240 && !s.twoPoint) { if (run) v += 1.5; else if (fam === 'deep') v -= 1; }
  const at = s.recent.lastIndexOf(p.id);
  if (at >= 0) {
    const back = s.recent.length - 1 - at;
    v -= back === 0 ? 2 : back === 1 ? 1 : back <= 3 ? 0.4 : 0;
  }
  return v;
}

/** The coach's pick for the offense. */
export function coachOffense(s: Situation, seed: number): number {
  let best = 0;
  let bestV = -1e9;
  for (const p of PLAYBOOK) {
    const v = offenseScore(p, s) + noise(seed, p.id) * 1.2;
    if (v > bestV) { bestV = v; best = p.id; }
  }
  return best;
}

/** What the offense has been doing lately, as shares of its last calls. */
export function tendencies(recent: number[]): { run: number; short: number; deep: number; special: number } {
  const t = { run: 0, short: 0, deep: 0, special: 0 };
  const last = recent.slice(-6);
  for (const id of last) { const p = PLAYBOOK[id]; if (p) t[p.cat] += 1; }
  const n = Math.max(1, last.length);
  return { run: t.run / n, short: t.short / n, deep: t.deep / n, special: t.special / n };
}

/** Each call's fit by yards to go. Close weights, so the computer stays hard to read. */
const DEF_FIT: Record<'short' | 'medium' | 'long' | 'veryLong', Record<string, number>> = {
  short: { 'RUN STUFF': 2.1, 'COVER 0': 1.5, 'MAN PRESS': 1.5, 'LB BLITZ': 1.4, 'COVER 1': 1.3, 'FIRE ZONE': 1.1, 'COVER 3': 0.7, 'COVER 2': 0.3, 'PREVENT': -3 },
  medium: { 'COVER 1': 1.5, 'FIRE ZONE': 1.45, 'MAN PRESS': 1.35, 'COVER 3': 1.35, 'LB BLITZ': 1.3, 'COVER 2': 1.1, 'RUN STUFF': 1.0, 'COVER 0': 0.9, 'PREVENT': -1.5 },
  long: { 'COVER 3': 1.55, 'COVER 2': 1.55, 'FIRE ZONE': 1.35, 'COVER 1': 1.3, 'LB BLITZ': 1.1, 'MAN PRESS': 1.0, 'COVER 0': 0.7, 'PREVENT': 0.4, 'RUN STUFF': 0.4 },
  veryLong: { 'COVER 2': 1.7, 'COVER 3': 1.6, 'PREVENT': 1.0, 'FIRE ZONE': 1.0, 'COVER 1': 0.8, 'LB BLITZ': 0.5, 'MAN PRESS': 0.5, 'COVER 0': 0.1, 'RUN STUFF': -1.5 },
};

export function defenseScore(c: DefCall, s: Situation): number {
  const need = s.twoPoint ? s.toGoal : Math.min(s.toGo, s.toGoal);
  const n = c.name;
  const band = need <= 2 ? 'short' : need <= 6 ? 'medium' : need <= 12 ? 'long' : 'veryLong';
  let v = DEF_FIT[band][n] ?? 0;
  if (n === 'PREVENT' && s.toGo >= 18) v += 0.8;
  if (s.down === 1 && !s.twoPoint) v += n === 'RUN STUFF' ? 0.35 : n === 'COVER 3' ? 0.2 : 0;
  if (s.toGoal <= 10) v += ({ 'MAN PRESS': 1, 'COVER 1': 0.7, 'COVER 0': 0.7, 'COVER 2': 0.3, 'PREVENT': -5 } as Record<string, number>)[n] ?? 0;
  // Protecting a late lead: keep everything in front.
  if (s.period >= 4 && s.lead < 0 && s.lead >= -8 && s.clock <= 60 && need > 3 && !s.twoPoint) v += n === 'PREVENT' ? 2.5 : n === 'COVER 2' ? 1 : 0;
  const t = tendencies(s.recent);
  if (t.run > 0.5) v += n === 'RUN STUFF' ? 1.2 : n === 'FIRE ZONE' ? 0.4 : 0;
  if (t.deep + t.special > 0.5) v += n === 'COVER 2' ? 0.8 : n === 'PREVENT' ? 0.3 : n === 'COVER 3' ? 0.4 : 0;
  if (t.short > 0.5) v += n === 'MAN PRESS' ? 0.9 : n === 'COVER 1' ? 0.4 : 0;
  return v;
}

/** The coach's pick for the defense. A wider spread keeps the computer's own calls hard to predict. */
export function coachDefense(s: Situation, seed: number, spread = 1.2): number {
  let best = 0;
  let bestV = -1e9;
  for (const c of DEF_CALLS) {
    const v = defenseScore(c, s) + noise(seed, 100 + c.id) * spread;
    if (v > bestV) { bestV = v; best = c.id; }
  }
  return best;
}

/** A bot's call, as a person might make it: mostly the coach's pick, sometimes another play of the same kind. */
export function botCall(side: 'off' | 'def', suggest: number, r: number): number {
  if (r < 0.65) return suggest;
  const pool = side === 'off'
    ? PLAYBOOK.filter((p) => p.cat === PLAYBOOK[suggest].cat).map((p) => p.id)
    : DEF_CALLS.filter((c) => c.cat === DEF_CALLS[suggest].cat).map((c) => c.id);
  return pool[Math.floor(((r - 0.65) / 0.35) * pool.length) % pool.length];
}
