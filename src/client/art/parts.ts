// The shared body grids, one letter per art pixel. Each letter is a palette slot, and '.' is empty. See palette.ts for the slots.
export type Grid = readonly string[];

const HELMET: Grid = [
  '.HHHH.',
  'HHHHHH',
  'HTHHGG',
  'HHHSSG',
  '.hhSS.',
];
const REF_CAP: Grid = [
  '.KKKK.',
  'KKKKKKK',
  '.SSSSS',
  '.sSSS.',
];
const CHEER_HEAD: Grid = [
  '.RRRR.',
  'RRRRRR',
  'RRSSSS',
  'R.SSS.',
];
const CAP_HEAD: Grid = [
  '.HHHH.',
  'HHHHHHH',
  '.SSSSS',
  '.sSSS.',
];

const TORSO_STD: Grid = [
  'JJJJJJ',
  'JJNNJJ',
  'JJNNJJ',
  'jjjjjj',
  'PPPPPP',
];
const TORSO_BIG: Grid = [
  'JJJJJJJJ',
  'JJJNNJJJ',
  'JJJNNJJJ',
  'jjjjjjjj',
  'PPPPPPPP',
];
const TORSO_SLIM: Grid = [
  'JJJJJ',
  'JJNNJ',
  'JJNNJ',
  'jjjjj',
  'PPPPP',
];
const TORSO_REF: Grid = [
  'WKWKWK',
  'WKWKWK',
  'WKWKWK',
  'KKKKKK',
];
const TORSO_CHEER: Grid = [
  'JJJJJ',
  'JNNJJ',
  'SSSSS',
  'TTTTT',
  'TtTtT',
];
const TORSO_POLO: Grid = [
  'JWWWJJ',
  'JJJJJJ',
  'JJJJJJ',
  'KKKKKK',
];
const TORSO_VEST: Grid = [
  'KgGgKK',
  'KKKKKK',
  'KgKgKK',
  'KKKKKK',
];

export type BuildName = 'std' | 'big' | 'slim' | 'ref' | 'cheer' | 'coach' | 'photo';

export interface Build {
  head: Grid; torso: Grid;
  legW: number; armW: number;
  thigh: string; shin: string; shoe: string; sleeve: string; fore: string;
}

export const BUILDS: Record<BuildName, Build> = {
  std: { head: HELMET, torso: TORSO_STD, legW: 2, armW: 2, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  big: { head: HELMET, torso: TORSO_BIG, legW: 3, armW: 2, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  slim: { head: HELMET, torso: TORSO_SLIM, legW: 2, armW: 1, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  ref: { head: REF_CAP, torso: TORSO_REF, legW: 2, armW: 2, thigh: 'W', shin: 'W', shoe: 'K', sleeve: 'K', fore: 'S' },
  cheer: { head: CHEER_HEAD, torso: TORSO_CHEER, legW: 2, armW: 1, thigh: 'S', shin: 'S', shoe: 'W', sleeve: 'S', fore: 'S' },
  coach: { head: CAP_HEAD, torso: TORSO_POLO, legW: 2, armW: 2, thigh: 'C', shin: 'C', shoe: 'K', sleeve: 'J', fore: 'S' },
  photo: { head: CAP_HEAD, torso: TORSO_VEST, legW: 2, armW: 2, thigh: 'C', shin: 'C', shoe: 'K', sleeve: 'K', fore: 'S' },
};

// Small things held in the front hand.
export const PROPS: Record<string, Grid> = {
  pom: ['TtT', 'tTt', 'TtT'],
  flag: ['YY', 'YY'],
  clipboard: ['WW', 'WW', 'KK'],
  camera: ['KK.', 'KGK', 'KKK'],
};
