// The playbook: formations, routes, offensive plays and defensive calls.
// Spots are [forward, lateral] yards from the ball. Forward below 0 is behind the line, and
// lateral above 0 is the formation's right side. Both are mirrored with the attack direction.

export type Spot = [number, number];

export type FormationId = 'gun' | 'single' | 'iform' | 'trips' | 'empty' | 'heavy';

export interface Formation { name: string; gun: boolean; qb: Spot; rb: Spot; wr1: Spot; wr2: Spot; te: Spot }

export const FORMATIONS: Record<FormationId, Formation> = {
  gun: { name: 'SHOTGUN', gun: true, qb: [-3.6, 0], rb: [-3.6, 1.7], wr1: [-0.6, -6.6], wr2: [-0.6, 6.6], te: [-0.6, 3.4] },
  single: { name: 'SINGLEBACK', gun: false, qb: [-1.2, 0], rb: [-5, 0], wr1: [-0.6, -6.6], wr2: [-0.6, 6.6], te: [-0.6, 3.4] },
  // The TE lines up as the fullback.
  iform: { name: 'I-FORM', gun: false, qb: [-1.2, 0], rb: [-5.6, 0], wr1: [-0.6, -6.6], wr2: [-0.6, 6.6], te: [-3.2, 0] },
  trips: { name: 'TRIPS', gun: true, qb: [-3.6, 0], rb: [-3.6, -1.7], wr1: [-1.2, 5.2], wr2: [-0.6, 7.2], te: [-0.6, 3.2] },
  empty: { name: 'EMPTY', gun: true, qb: [-3.6, 0], rb: [-1.2, -4.2], wr1: [-0.6, -7], wr2: [-0.6, 7], te: [-1.2, 4.2] },
  heavy: { name: 'GOAL LINE', gun: false, qb: [-1.2, 0], rb: [-4.6, 0], wr1: [-0.6, -3.4], wr2: [-1.2, 4.9], te: [-0.6, 3.2] },
};

/** The three linemen, left to right. */
export const OL_SPOTS: Spot[] = [[-0.6, -1.7], [-0.6, 0], [-0.6, 1.7]];

// Routes are [forward, out] offsets from the player's start, where "out" points toward that player's sideline.
export type RouteName =
  | 'hitch' | 'stick' | 'curl' | 'comeback' | 'slant' | 'out' | 'sail' | 'dig' | 'post' | 'corner'
  | 'go' | 'seam' | 'drag' | 'shallow' | 'cross' | 'flat' | 'swing' | 'wheel' | 'angle' | 'screen' | 'bubble';

export interface RouteDef { pts: [number, number][]; stop: boolean }

export const ROUTES: Record<RouteName, RouteDef> = {
  hitch: { pts: [[6, 0], [5, 0]], stop: true },
  stick: { pts: [[5, 0], [5, -0.6]], stop: true },
  curl: { pts: [[11, 0], [9.5, -1]], stop: true },
  comeback: { pts: [[13, 0], [11.5, 1.5]], stop: true },
  slant: { pts: [[1.5, 0.5], [3, -1], [15, -12]], stop: false },
  out: { pts: [[6, 0], [6.5, 1], [6.5, 9]], stop: false },
  sail: { pts: [[10, 0], [12, 2], [13, 9]], stop: false },
  dig: { pts: [[10, 0], [11, -1], [11, -14]], stop: false },
  post: { pts: [[11, 0], [26, -7]], stop: false },
  corner: { pts: [[10, 0], [22, 7]], stop: false },
  go: { pts: [[60, 0]], stop: false },
  seam: { pts: [[4, -0.4], [60, -0.8]], stop: false },
  drag: { pts: [[1.5, -1], [2.5, -15]], stop: false },
  shallow: { pts: [[3, -1], [4, -15]], stop: false },
  cross: { pts: [[7, -1], [12, -15]], stop: false },
  flat: { pts: [[0.5, 2], [1.5, 8]], stop: false },
  swing: { pts: [[-1, 2.5], [0.5, 7]], stop: false },
  wheel: { pts: [[0, 3], [3, 6], [60, 6.5]], stop: false },
  angle: { pts: [[1, 2.5], [4, 1.5], [7, -3]], stop: false },
  screen: { pts: [[-1.5, 2.5], [-1, 5]], stop: true },
  bubble: { pts: [[-1, 1.5], [-0.5, 3.5]], stop: true },
};

/** What a skill player does: a route, a pass block, a block on a defender downfield, or a lead block through the hole. */
export type Assign = RouteName | 'block' | 'stalk' | 'lead';

export type PlayCat = 'run' | 'short' | 'deep' | 'special';
export type PlayKind = 'pass' | 'run' | 'pa' | 'screen' | 'sneak';

export interface RunDef {
  /** Lateral offset of the hole, in formation coordinates. */
  hole: number;
  /** A first step toward this lateral before the cut, for counters. */
  fake?: number;
  /** Seconds after the snap the ball is handed over. Draws wait for the rush. */
  mesh: number;
  /** The backside lineman pulls to lead through the hole. */
  pull?: boolean;
}

export interface Play {
  id: number; name: string; cat: PlayCat; kind: PlayKind; formation: FormationId;
  wr1: Assign; wr2: Assign; te: Assign; rb: Assign;
  /** Which way a back lined up in the middle breaks. 1 is the formation's right. */
  rbSide: 1 | -1; teSide: 1 | -1;
  /** The run, or the fake for play action. */
  run: RunDef | null;
  /** The yards the play is built for, which the coach weighs against the distance to go. */
  gain: [number, number];
  /** One line for the card. */
  tip: string;
}

type PlayOpts = Pick<Play, 'name' | 'cat' | 'kind' | 'formation' | 'wr1' | 'wr2' | 'te' | 'rb' | 'gain' | 'tip'> & Partial<Pick<Play, 'rbSide' | 'teSide' | 'run'>>;

const P: Play[] = [];
const add = (o: PlayOpts): void => { P.push({ rbSide: 1, teSide: 1, run: null, ...o, id: P.length }); };

// Run
add({ name: 'HB DIVE', cat: 'run', kind: 'run', formation: 'single', wr1: 'stalk', wr2: 'stalk', te: 'block', rb: 'block', run: { hole: 0.9, mesh: 0.4 }, gain: [2, 5], tip: 'SAFE INSIDE RUN' });
add({ name: 'POWER O', cat: 'run', kind: 'run', formation: 'iform', wr1: 'stalk', wr2: 'stalk', te: 'lead', rb: 'block', run: { hole: 2.8, mesh: 0.5, pull: true }, gain: [3, 7], tip: 'GUARD PULLS, FB LEADS' });
add({ name: 'STRETCH', cat: 'run', kind: 'run', formation: 'single', wr1: 'stalk', wr2: 'stalk', te: 'block', rb: 'block', run: { hole: 6.2, mesh: 0.35 }, gain: [0, 12], tip: 'BOUNCE IT OUTSIDE' });
add({ name: 'COUNTER', cat: 'run', kind: 'run', formation: 'gun', wr1: 'stalk', wr2: 'stalk', te: 'block', rb: 'block', run: { hole: -2.8, fake: 2.4, mesh: 0.55, pull: true }, gain: [1, 9], tip: 'FAKE ONE WAY, CUT BACK' });
add({ name: 'HB DRAW', cat: 'run', kind: 'run', formation: 'gun', wr1: 'go', wr2: 'go', te: 'block', rb: 'block', run: { hole: 0.9, mesh: 1.0 }, gain: [2, 10], tip: 'LOOKS LIKE A PASS' });
add({ name: 'QB SNEAK', cat: 'run', kind: 'sneak', formation: 'heavy', wr1: 'block', wr2: 'block', te: 'block', rb: 'block', run: { hole: 0, mesh: 0 }, gain: [1, 2], tip: 'PUSH FOR A YARD' });
// Short
add({ name: 'SLANTS', cat: 'short', kind: 'pass', formation: 'gun', wr1: 'slant', wr2: 'slant', te: 'stick', rb: 'flat', gain: [4, 9], tip: 'QUICK, BEATS MAN' });
add({ name: 'MESH', cat: 'short', kind: 'pass', formation: 'gun', wr1: 'drag', wr2: 'shallow', te: 'seam', rb: 'angle', gain: [4, 10], tip: 'CROSSERS RUB MAN' });
add({ name: 'CURL FLAT', cat: 'short', kind: 'pass', formation: 'single', wr1: 'curl', wr2: 'curl', te: 'flat', rb: 'swing', rbSide: -1, gain: [5, 10], tip: 'SITS IN ZONE HOLES' });
add({ name: 'STICK', cat: 'short', kind: 'pass', formation: 'trips', wr1: 'stick', wr2: 'go', te: 'flat', rb: 'swing', gain: [4, 7], tip: 'EASY READ, THE STICKS' });
add({ name: 'QUICK OUTS', cat: 'short', kind: 'pass', formation: 'empty', wr1: 'out', wr2: 'out', te: 'hitch', rb: 'hitch', gain: [5, 8], tip: 'SIDELINE, SAVES CLOCK' });
add({ name: 'TWIN HITCH', cat: 'short', kind: 'pass', formation: 'single', wr1: 'hitch', wr2: 'hitch', te: 'seam', rb: 'flat', gain: [4, 6], tip: 'BEATS SOFT COVERAGE' });
// Deep
add({ name: 'FOUR VERTS', cat: 'deep', kind: 'pass', formation: 'empty', wr1: 'go', wr2: 'go', te: 'seam', rb: 'seam', gain: [15, 40], tip: 'STRETCH THE SAFETIES' });
add({ name: 'POST CORNER', cat: 'deep', kind: 'pass', formation: 'single', wr1: 'post', wr2: 'corner', te: 'dig', rb: 'block', gain: [12, 30], tip: 'TWO SHOTS DOWNFIELD' });
add({ name: 'DAGGER', cat: 'deep', kind: 'pass', formation: 'gun', wr1: 'hitch', wr2: 'dig', te: 'seam', rb: 'block', gain: [10, 18], tip: 'DIG UNDER THE SEAM' });
add({ name: 'FLOOD', cat: 'deep', kind: 'pass', formation: 'trips', wr1: 'sail', wr2: 'go', te: 'flat', rb: 'block', gain: [8, 18], tip: 'THREE LEVELS, ONE SIDE' });
add({ name: 'Y CROSS', cat: 'deep', kind: 'pass', formation: 'single', wr1: 'go', wr2: 'post', te: 'cross', rb: 'swing', gain: [10, 20], tip: 'TE CROSSES DEEP' });
add({ name: 'MAX PROTECT', cat: 'deep', kind: 'pass', formation: 'iform', wr1: 'go', wr2: 'post', te: 'block', rb: 'block', gain: [15, 40], tip: 'MORE TIME, GO DEEP' });
// Special
add({ name: 'PA POST', cat: 'special', kind: 'pa', formation: 'single', wr1: 'post', wr2: 'dig', te: 'drag', rb: 'block', run: { hole: 0.9, mesh: 0.55 }, gain: [12, 30], tip: 'FAKE THE DIVE, GO DEEP' });
add({ name: 'PA CROSSERS', cat: 'special', kind: 'pa', formation: 'iform', wr1: 'cross', wr2: 'go', te: 'flat', rb: 'block', run: { hole: 2.8, mesh: 0.55 }, gain: [8, 20], tip: 'FAKE POWER, CROSS' });
add({ name: 'PA SHOT', cat: 'special', kind: 'pa', formation: 'single', wr1: 'go', wr2: 'go', te: 'block', rb: 'block', run: { hole: 0.9, mesh: 0.7 }, gain: [20, 50], tip: 'SELL THE RUN, BOMB' });
add({ name: 'HB SCREEN', cat: 'special', kind: 'screen', formation: 'gun', wr1: 'go', wr2: 'go', te: 'block', rb: 'screen', gain: [3, 15], tip: 'LET THE RUSH IN' });
add({ name: 'BUBBLE', cat: 'special', kind: 'screen', formation: 'trips', wr1: 'bubble', wr2: 'stalk', te: 'stalk', rb: 'block', gain: [3, 10], tip: 'QUICK, BLOCKERS AHEAD' });
add({ name: 'HB WHEEL', cat: 'special', kind: 'pass', formation: 'gun', wr1: 'dig', wr2: 'slant', te: 'stick', rb: 'wheel', gain: [6, 30], tip: 'RB UP THE SIDELINE' });

export const PLAYBOOK: readonly Play[] = P;

export const PLAY_CATS: { id: PlayCat; label: string }[] = [
  { id: 'run', label: 'RUN' }, { id: 'short', label: 'SHORT' }, { id: 'deep', label: 'DEEP' }, { id: 'special', label: 'SPECIAL' },
];

export function playsIn(cat: PlayCat): Play[] { return PLAYBOOK.filter((p) => p.cat === cat); }

export function isRunKind(k: PlayKind): boolean { return k === 'run' || k === 'sneak'; }

// --- Defense -----------------------------------------------------------------

// Defender order: 0-2 DL left to right, 3-4 LB left and right, 5-6 CB left and right, 7 the safety.
// Receivers a man defender can be given: 1 RB, 2 WR1, 3 WR2, 4 TE.

/** A zone, as a landmark [depth, lateral] with a half-width and the depths it guards. */
export interface ZoneDef { at: Spot; hw: number; d0: number; d1: number; deep: boolean }

export type DefJob =
  | { k: 'rush' }
  | { k: 'man'; on: 1 | 2 | 3 | 4 }
  | { k: 'deep' }
  | { k: 'zone'; z: ZoneDef }
  /** Hit the back on the snap: a run fit, or tight man coverage if he releases. */
  | { k: 'crash' };

export type DefCat = 'man' | 'zone' | 'pressure';

export interface DefCall {
  id: number; name: string; cat: DefCat; tip: string;
  jobs: DefJob[];
  /** Corners jam their man at the line. */
  press: boolean;
}

const rush: DefJob = { k: 'rush' };
const man = (on: 1 | 2 | 3 | 4): DefJob => ({ k: 'man', on });
const zone = (d: number, l: number, hw: number, d0: number, d1: number, deep = false): DefJob => ({ k: 'zone', z: { at: [d, l], hw, d0, d1, deep } });
const deep3L = zone(15, -5.7, 2.9, 7, 60, true);
const deep3M = zone(16, 0, 2.9, 8, 60, true);
const deep3R = zone(15, 5.7, 2.9, 7, 60, true);

const D: DefCall[] = [];
const def = (name: string, cat: DefCat, tip: string, jobs: DefJob[], press = false): void => { D.push({ id: D.length, name, cat, tip, jobs, press }); };

def('COVER 1', 'man', 'MAN, ONE DEEP SAFETY', [rush, rush, rush, man(4), man(1), man(2), man(3), { k: 'deep' }]);
def('MAN PRESS', 'man', 'JAM THEM AT THE LINE', [rush, rush, rush, man(4), man(1), man(2), man(3), { k: 'deep' }], true);
def('LB BLITZ', 'man', 'FOUR RUSH, NO SAFETY', [rush, rush, rush, man(4), rush, man(2), man(3), man(1)]);
def('COVER 2', 'zone', 'TWO DEEP HALVES', [rush, rush, rush, zone(4, -5.6, 3, 0, 9), zone(4, 5.6, 3, 0, 9), zone(14, -4.3, 4.3, 8, 60, true), zone(14, 4.3, 4.3, 8, 60, true), zone(8, 0, 2.6, 3, 14)]);
def('COVER 3', 'zone', 'THREE DEEP, SAFE', [rush, rush, rush, zone(6, -3.4, 3.4, 0, 11), zone(6, 3.4, 3.4, 0, 11), deep3L, deep3R, deep3M]);
def('PREVENT', 'zone', 'NOTHING GETS DEEP', [rush, rush, zone(4, 0, 3.2, 1, 8), zone(9, -3.5, 3.8, 4, 14), zone(9, 3.5, 3.8, 4, 14), zone(20, -5.7, 2.9, 12, 60, true), zone(20, 5.7, 2.9, 12, 60, true), zone(22, 0, 2.9, 12, 60, true)]);
def('COVER 0', 'pressure', 'ALL-OUT BLITZ', [rush, rush, rush, rush, rush, man(2), man(3), man(4)]);
def('FIRE ZONE', 'pressure', 'BLITZ, LINEMAN DROPS', [rush, zone(5, 0, 4.6, 1, 9), rush, rush, rush, deep3L, deep3R, deep3M]);
def('RUN STUFF', 'pressure', 'SELL OUT VS THE RUN', [rush, rush, rush, { k: 'crash' }, { k: 'crash' }, man(2), man(3), man(4)], true);

export const DEF_CALLS: readonly DefCall[] = D;

export const DEF_CATS: { id: DefCat; label: string }[] = [{ id: 'man', label: 'MAN' }, { id: 'zone', label: 'ZONE' }, { id: 'pressure', label: 'PRESSURE' }];

export function rushers(c: DefCall): number { return c.jobs.filter((j) => j.k === 'rush').length; }
