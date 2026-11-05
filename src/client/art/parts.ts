// The shared body grids. Each letter is a palette slot, and '.' is empty. See palette.ts for the slots.
export type Grid = readonly string[];

const HELMET: Grid = [
  '.HHHHH.',
  'HHHHHHH',
  'HTHHHSS',
  'HTHHSSG',
  'HHHHSGG',
  '.hhh.G.',
];
const REF_CAP: Grid = [
  '.KKKK..',
  'KKKKKKK',
  '.SSSSSK',
  '.SSSSS.',
  '.sSSS..',
];
const CHEER_HEAD: Grid = [
  '.RRRRR.',
  'RRRRRRR',
  'RRSSSSS',
  'RRSSSSS',
  'RRSSSS.',
  'R..S...',
];
const CAP_HEAD: Grid = [
  '.HHHH..',
  'HHHHHHH',
  '.SSSSS.',
  '.SSSSS.',
  '.sSSS..',
];

const TORSO_STD: Grid = [
  '.JJJJJJ.',
  'JJJJJJJJ',
  'JJJNNJJJ',
  'JJJNNJJJ',
  'JJJNNJJJ',
  'JJJJJJJJ',
  '.jjjjjj.',
  '.TTTTTT.',
  '.PPPPPP.',
];
const TORSO_BIG: Grid = [
  '.JJJJJJJJ.',
  'JJJJJJJJJJ',
  'JJJJNNJJJJ',
  'JJJJNNJJJJ',
  'JJJJNNJJJJ',
  'JJJJJJJJJJ',
  'jjjjjjjjjj',
  '.TTTTTTTT.',
  '.PPPPPPPP.',
];
const TORSO_SLIM: Grid = [
  '.JJJJ.',
  'JJJJJJ',
  'JJNNJJ',
  'JJNNJJ',
  'JJJJJJ',
  'JJJJJJ',
  '.jjjj.',
  '.TTTT.',
  '.PPPP.',
];
const TORSO_REF: Grid = [
  '.WKWKW.',
  'KWKWKWK',
  'KWKWKWK',
  'KWKWKWK',
  'KWKWKWK',
  'KWKWKWK',
  '.WKWKW.',
  '.KKKKK.',
];
const TORSO_CHEER: Grid = [
  '.JJJJ.',
  'JJJJJJ',
  'JJNNJJ',
  'JJJJJJ',
  '.SSSS.',
  '.SSSS.',
  'TTTTTT',
  'TtTtTT',
  'TTTTTT',
];
const TORSO_POLO: Grid = [
  '.JJJJJ.',
  'JJWWWJJ',
  'JJJJJJJ',
  'JJJJJJJ',
  'JJJJJJJ',
  'JJJJJJJ',
  '.jjjjj.',
  '.KKKKK.',
];
const TORSO_VEST: Grid = [
  '.KKKKK.',
  'KKgGgKK',
  'KKKKKKK',
  'KKgKgKK',
  'KKKKKKK',
  'KKKKKKK',
  '.KKKKK.',
  '.KKKKK.',
];

export type BuildName = 'std' | 'big' | 'slim' | 'ref' | 'cheer' | 'coach' | 'photo';

export interface Build {
  head: Grid; torso: Grid;
  legW: number; armW: number;
  thigh: string; shin: string; shoe: string; sleeve: string; fore: string;
}

export const BUILDS: Record<BuildName, Build> = {
  std: { head: HELMET, torso: TORSO_STD, legW: 3, armW: 2, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  big: { head: HELMET, torso: TORSO_BIG, legW: 4, armW: 3, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  slim: { head: HELMET, torso: TORSO_SLIM, legW: 2, armW: 2, thigh: 'P', shin: 'T', shoe: 'K', sleeve: 'J', fore: 'S' },
  ref: { head: REF_CAP, torso: TORSO_REF, legW: 3, armW: 2, thigh: 'W', shin: 'W', shoe: 'K', sleeve: 'K', fore: 'S' },
  cheer: { head: CHEER_HEAD, torso: TORSO_CHEER, legW: 2, armW: 2, thigh: 'S', shin: 'S', shoe: 'W', sleeve: 'S', fore: 'S' },
  coach: { head: CAP_HEAD, torso: TORSO_POLO, legW: 3, armW: 2, thigh: 'C', shin: 'C', shoe: 'K', sleeve: 'J', fore: 'S' },
  photo: { head: CAP_HEAD, torso: TORSO_VEST, legW: 3, armW: 2, thigh: 'C', shin: 'C', shoe: 'K', sleeve: 'K', fore: 'S' },
};

// Small things held in the front hand.
export const PROPS: Record<string, Grid> = {
  pom: ['.TtT.', 'TTTTT', 'tTTTt', 'TTTTT', '.TtT.'],
  flag: ['YYY', 'YYY', 'YY.'],
  clipboard: ['WWW', 'WWW', 'WWW', 'KKK'],
  camera: ['.KK.', 'KKKK', 'KGGK', 'KKKK'],
};
