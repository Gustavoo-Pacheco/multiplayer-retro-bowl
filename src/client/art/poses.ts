// Poses written as joints rather than pixels, so every frame comes from the same few body grids.
import type { BuildName } from './parts';

/** Elbow or knee x,y, then hand or foot x,y, relative to the shoulder or hip. y grows downward. */
export type Limb = readonly [number, number, number, number];

export interface Pose {
  /** Height of the hips above the feet, which sets how the torso and head sit. */
  hip: number;
  /** How far the shoulders sit ahead of the hips. */
  lean?: number;
  legF: Limb; legB: Limb; armF: Limb; armB: Limb;
  /** Lifts the whole figure off the ground. */
  air?: number;
  /** Rotates the finished figure a quarter turn, for players on the ground. */
  prone?: boolean;
  /** Head offset, for a head that's down or up. */
  head?: readonly [number, number];
  prop?: string;
}

const swap = (p: Pose): Pose => ({ ...p, legF: p.legB, legB: p.legF, armF: p.armB, armB: p.armF });
/** Swaps the legs only, for a figure whose arms are busy. */
const swapLegs = (p: Pose): Pose => ({ ...p, legF: p.legB, legB: p.legF });

const STAND: Pose = { hip: 12, legF: [1, 6, 1, 12], legB: [-1, 6, -2, 12], armF: [2, 4, 2, 8], armB: [-2, 4, -3, 8] };
const READY: Pose = { hip: 10, lean: 2, legF: [3, 5, 3, 10], legB: [-2, 5, -3, 10], armF: [3, 4, 5, 7], armB: [1, 5, 2, 8] };

const RUN_A: Pose = { hip: 11, lean: 3, legF: [4, 5, 6, 11], legB: [-3, 5, -7, 8], armF: [-3, 4, -2, 8], armB: [3, 4, 6, 2] };
const RUN_B: Pose = { hip: 12, lean: 2, legF: [2, 6, 0, 12], legB: [2, 4, -2, 8], armF: [1, 5, 2, 8], armB: [1, 5, 0, 8] };
const RUN = [RUN_A, RUN_B, swap(RUN_A), swap(RUN_B)];

/** The same running legs, with the front arm holding the ball tucked. */
const tuck = (p: Pose): Pose => ({ ...p, armF: [2, 4, 5, 3] });
const RUN_BALL = [tuck(RUN_A), tuck(RUN_B), tuck(swapLegs(RUN_A)), tuck(swapLegs(RUN_B))];

const KNEEL: Pose = { hip: 7, lean: 2, legF: [4, 3, 4, 7], legB: [-1, 6, -6, 7], armF: [3, 4, 4, 8], armB: [-1, 5, 0, 8], head: [1, 1] };
const LIE: Pose = { hip: 12, legF: [1, 6, 0, 12], legB: [-1, 6, -2, 12], armF: [-1, 4, -1, 8], armB: [1, 4, 2, 8], prone: true };
const ARMS_UP: Pose = { hip: 12, legF: [2, 6, 2, 12], legB: [-2, 6, -3, 12], armF: [3, -3, 4, -7], armB: [-3, -3, -4, -7] };
const WRAP: Pose = { hip: 9, lean: 6, legF: [4, 4, 3, 9], legB: [-4, 5, -8, 8], armF: [5, 1, 9, 1], armB: [5, 3, 9, 4], head: [1, 2] };
const BLOCK: Pose = { hip: 10, lean: 3, legF: [4, 5, 5, 10], legB: [-3, 5, -6, 10], armF: [4, 1, 7, 1], armB: [4, 3, 7, 3] };

export const POSES: Record<string, Pose[]> = {
  stance: [STAND],
  ready: [READY],
  // A three-point stance for the lines.
  stance3: [{ hip: 9, lean: 7, legF: [3, 5, 3, 9], legB: [-3, 4, -5, 9], armF: [3, 5, 4, 12], armB: [0, 4, -2, 7], head: [1, 2] }],
  run: RUN,
  runBall: RUN_BALL,
  backpedal: [
    { hip: 10, lean: -1, legF: [2, 5, 1, 10], legB: [-3, 5, -4, 10], armF: [2, 5, 4, 7], armB: [0, 5, 1, 8] },
    { hip: 11, lean: -1, legF: [0, 6, -1, 11], legB: [-1, 5, 2, 9], armF: [2, 5, 3, 8], armB: [0, 5, 2, 7] },
  ],
  dropBack: [
    { hip: 11, lean: -1, legF: [3, 5, 4, 11], legB: [-3, 5, -5, 9], armF: [2, 3, 5, 1], armB: [2, 4, 5, 2] },
    { hip: 12, lean: -1, legF: [0, 6, -1, 12], legB: [0, 5, 2, 9], armF: [2, 3, 5, 1], armB: [2, 4, 5, 2] },
  ],
  aim: [{ hip: 11, lean: -1, legF: [3, 5, 4, 11], legB: [-2, 6, -4, 11], armF: [-3, -1, -2, -5], armB: [4, 1, 7, 0] }],
  throw: [{ hip: 11, lean: 4, legF: [5, 5, 7, 11], legB: [-3, 5, -6, 10], armF: [3, -3, 8, -3], armB: [-3, 4, -5, 7] }],
  handoff: [{ hip: 11, lean: 2, legF: [3, 5, 3, 11], legB: [-2, 6, -3, 11], armF: [3, 3, 8, 4], armB: [3, 4, 7, 5] }],
  scramble: RUN_BALL,
  sacked: [{ ...LIE, armF: [2, 3, 6, 2] }],
  catch: [{ hip: 12, air: 2, legF: [2, 6, 1, 11], legB: [-2, 5, -4, 9], armF: [3, -3, 4, -7], armB: [2, -3, 3, -7], head: [0, -1] }],
  drop: [{ hip: 12, lean: -2, legF: [3, 6, 3, 12], legB: [-2, 6, -4, 12], armF: [4, 2, 7, 4], armB: [-3, 3, -6, 5] }],
  jukeL: [{ hip: 10, lean: -3, legF: [5, 4, 8, 10], legB: [-3, 6, -4, 10], armF: [2, 4, 5, 3], armB: [-3, 2, -6, 0] }],
  jukeR: [{ hip: 10, lean: 5, legF: [3, 6, 2, 10], legB: [-5, 3, -8, 8], armF: [2, 4, 5, 3], armB: [4, 2, 7, 0] }],
  stiff: [{ ...RUN_B, lean: 2, armF: [2, 4, 5, 3], armB: [5, 0, 10, -1] }, { ...RUN_A, lean: 2, armF: [2, 4, 5, 3], armB: [5, 0, 10, -1] }],
  dive: [{ hip: 12, air: 4, prone: true, legF: [1, 6, 2, 11], legB: [-1, 6, -2, 12], armF: [2, -4, 2, -8], armB: [0, -4, 0, -8] }],
  truck: [
    { hip: 9, lean: 6, legF: [4, 4, 5, 9], legB: [-4, 4, -7, 9], armF: [3, 3, 6, 2], armB: [5, 1, 8, 0], head: [1, 2] },
    { hip: 9, lean: 6, legF: [2, 5, 0, 9], legB: [-2, 3, -4, 8], armF: [3, 3, 6, 2], armB: [5, 1, 8, 0], head: [1, 2] },
  ],
  tackled: [LIE],
  fumble: [{ hip: 11, lean: 3, legF: [3, 5, 5, 11], legB: [-3, 5, -5, 10], armF: [4, -2, 7, -5], armB: [-3, -2, -6, -5] }],
  getUp: [{ ...KNEEL, lean: 4, armF: [3, 5, 5, 11] }],
  block: [BLOCK, swapLegs(BLOCK)],
  push: [{ ...BLOCK, lean: 5, hip: 9 }, { ...swapLegs(BLOCK), lean: 5, hip: 9 }],
  pushed: [{ hip: 11, lean: -3, legF: [3, 5, 5, 11], legB: [-1, 6, -4, 11], armF: [4, 1, 6, -1], armB: [4, 3, 6, 2] }],
  rush: [{ ...RUN_A, lean: 4, armF: [4, 2, 7, 3], armB: [4, 3, 7, 5] }, { ...RUN_B, lean: 4, armF: [4, 2, 7, 3], armB: [4, 3, 7, 5] }],
  tackle: [WRAP],
  sack: [{ ...WRAP, hip: 8, air: 1 }, { ...ARMS_UP }],
  int: [{ hip: 12, air: 3, legF: [3, 5, 2, 10], legB: [-2, 5, -4, 9], armF: [3, -3, 5, -7], armB: [2, -3, 3, -7], head: [0, -1] }],
  kickStance: [{ hip: 11, lean: 1, legF: [2, 5, 3, 11], legB: [-2, 5, -4, 11], armF: [2, 4, 4, 7], armB: [-2, 4, -4, 7] }],
  kickApproach: RUN,
  kick: [{ hip: 12, lean: -3, legF: [6, -1, 10, -4], legB: [0, 6, -1, 12], armF: [-3, 2, -6, 3], armB: [3, 1, 6, 0] }],
  onside: [{ hip: 11, lean: 2, legF: [5, 3, 9, 6], legB: [0, 6, -1, 11], armF: [-3, 3, -5, 5], armB: [3, 2, 6, 3] }],
  celebrate: [ARMS_UP, { ...ARMS_UP, air: 2, legF: [3, 5, 2, 9], legB: [-3, 5, -4, 9] }],
  hold: [{ ...KNEEL, armF: [4, 3, 7, 6], armB: [3, 4, 6, 7] }],
  punt: [{ hip: 12, lean: -4, legF: [6, -3, 11, -8], legB: [0, 6, -1, 12], armF: [4, 0, 7, -2], armB: [-3, 2, -5, 3] }],
  // Celebrations
  spike: [{ ...STAND, armF: [3, -3, 4, -7] }, { hip: 10, lean: 4, legF: [3, 5, 3, 10], legB: [-3, 5, -5, 10], armF: [4, 2, 7, 6], armB: [-3, 2, -6, 0] }],
  taunt: [{ ...STAND, lean: -2, armF: [4, -1, 7, -3], armB: [-1, 4, 1, 6] }, { ...STAND, lean: -2, legF: [2, 6, 3, 12], armF: [4, -2, 7, -5], armB: [-1, 4, 1, 6] }],
  kneel: [KNEEL],
  pile: [{ ...LIE, armF: [3, -2, 6, -4], armB: [-2, 3, -5, 2] }, { ...LIE, armF: [3, 2, 6, 4], armB: [-2, 2, -5, 4] }],
  tdDance: [
    { ...STAND, armF: [3, -3, 4, -7], armB: [-3, 3, -5, 6] },
    { ...STAND, legF: [3, 5, 4, 9], armF: [3, 3, 5, 6], armB: [-3, -3, -4, -7] },
    { ...STAND, armF: [3, -3, 4, -7], armB: [-3, 3, -5, 6], legB: [-3, 5, -5, 9] },
    ARMS_UP,
  ],
  // Injury
  hurt: [{ ...LIE, armF: [2, -3, 3, -6], legF: [3, 4, 2, 9] }, { ...LIE, armF: [2, -2, 4, -4], legF: [3, 4, 2, 9] }],
  helped: [
    { hip: 11, lean: 3, legF: [2, 6, 3, 11], legB: [-1, 5, -4, 8], armF: [3, -1, 7, -2], armB: [-1, 4, 0, 7], head: [1, 1] },
    { hip: 11, lean: 3, legF: [1, 6, 0, 11], legB: [-2, 6, -3, 10], armF: [3, -1, 7, -2], armB: [-1, 4, 0, 7], head: [1, 1] },
  ],
  // Referee signals
  refTd: [{ ...STAND, armF: [1, -4, 2, -8], armB: [-1, -4, -2, -8] }],
  refFirst: [{ ...STAND, armF: [4, 0, 8, -1], armB: [-1, 4, -2, 8] }],
  refIncomplete: [{ ...STAND, armF: [4, 1, 8, 1], armB: [-4, 1, -8, 1] }, { ...STAND, armF: [2, 3, -1, 3], armB: [-2, 3, 1, 3] }],
  refPenalty: [{ ...STAND, armF: [3, -3, 5, -7], armB: [-2, 4, -3, 8], prop: 'flag' }],
  // Sideline
  cheerIdle: [{ ...STAND, armF: [3, 3, 2, 7], armB: [-3, 3, -2, 7], prop: 'pom' }, { ...STAND, legF: [2, 6, 2, 12], armF: [3, 2, 2, 6], armB: [-3, 2, -2, 6], prop: 'pom' }],
  cheer: [
    { ...ARMS_UP, prop: 'pom' },
    { ...ARMS_UP, air: 2, legF: [4, 3, 2, 8], legB: [-4, 3, -2, 8], armF: [4, -2, 7, -5], armB: [-4, -2, -7, -5], prop: 'pom' },
  ],
  coachIdle: [{ ...STAND, armF: [3, 3, 5, 3], armB: [-2, 4, -3, 8], prop: 'clipboard' }, { ...STAND, armF: [3, 2, 5, 2], armB: [-2, 3, 0, 6], head: [1, 0], prop: 'clipboard' }],
  benchIdle: [STAND, { ...STAND, armB: [-1, 4, 1, 6], head: [1, 0] }],
  photoIdle: [
    { hip: 8, lean: 3, legF: [4, 3, 3, 8], legB: [-2, 5, -5, 8], armF: [3, 1, 5, -1], armB: [2, 2, 4, 0], prop: 'camera' },
    { hip: 8, lean: 3, legF: [4, 3, 3, 8], legB: [-2, 5, -5, 8], armF: [3, 2, 5, 0], armB: [2, 3, 4, 1], prop: 'camera' },
  ],
};

export interface SpriteGroup { name: string; build: BuildName; frames: string[]; sideline?: boolean }

/** The spec's 13 sprite groups. Each frame also has the animations from the sim that use it. */
export const GROUPS: SpriteGroup[] = [
  { name: 'Quarterback', build: 'std', frames: ['stance', 'dropBack', 'aim', 'throw', 'handoff', 'run', 'scramble', 'sacked'] },
  { name: 'Runner or receiver', build: 'std', frames: ['ready', 'run', 'runBall', 'catch', 'drop', 'jukeL', 'jukeR', 'stiff', 'dive', 'truck', 'tackled', 'fumble', 'getUp'] },
  { name: 'Tight end', build: 'big', frames: ['ready', 'run', 'runBall', 'catch', 'drop', 'jukeL', 'jukeR', 'stiff', 'dive', 'truck', 'tackled', 'fumble', 'getUp', 'block'] },
  { name: 'Offensive line', build: 'big', frames: ['stance3', 'block', 'push', 'pushed'] },
  { name: 'Defensive line', build: 'big', frames: ['stance3', 'rush', 'tackle', 'sack'] },
  { name: 'Linebacker and defensive back', build: 'std', frames: ['ready', 'backpedal', 'run', 'tackle', 'dive', 'int'] },
  { name: 'Kicker', build: 'slim', frames: ['kickStance', 'kickApproach', 'kick', 'onside', 'celebrate'] },
  { name: 'Punter or holder', build: 'slim', frames: ['hold', 'punt'] },
  { name: 'Referee', build: 'ref', frames: ['stance', 'refTd', 'refFirst', 'refIncomplete', 'refPenalty'] },
  { name: 'Celebrations', build: 'std', frames: ['spike', 'taunt', 'kneel', 'pile', 'tdDance'] },
  { name: 'Cheerleaders', build: 'cheer', frames: ['cheerIdle', 'cheer'] },
  { name: 'Injury', build: 'std', frames: ['hurt', 'helped'] },
  { name: 'Sideline crowd', build: 'coach', frames: ['coachIdle', 'benchIdle', 'photoIdle'], sideline: true },
];
