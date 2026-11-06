// Match settings, their defaults, and presets.
export interface MatchConfig {
  quarter: 1 | 2 | 3 | 5;
  playClock: 10 | 15 | 25;
  twoMinute: boolean;
  timeouts: 'auto' | 0 | 1 | 2 | 3;
  /** Who calls the defense: the player without the ball, or the computer. */
  defense: 'players' | 'computer';
  pauses: 0 | 2 | 5;
  reconnect: 1 | 2 | 5;
  difficulty: Difficulty;
  overtime: 'standard' | 'sudden' | 'off';
  returns: 'live' | 'touchback';
  onside: boolean;
  twoPoint: boolean;
  penalties: boolean;
  fumbles: 'off' | 'normal' | 'high';
  bullet: boolean;
  trucking: boolean;
  fatigue: boolean;
  injuries: boolean;
  ratings: 'real' | 'compressed' | 'equal';
  weather: 'clear' | 'rain' | 'snow' | 'wind' | 'random';
  aimCursor: 'fades' | 'full';
  replays: 'off' | 'big' | 'all';
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export type Weather = 'clear' | 'rain' | 'snow' | 'wind';

export const DEFAULT_CONFIG: MatchConfig = {
  quarter: 3, playClock: 15, twoMinute: true, timeouts: 'auto', defense: 'players', pauses: 2, reconnect: 2,
  difficulty: 'normal', overtime: 'standard', returns: 'live', onside: true, twoPoint: true, penalties: true,
  fumbles: 'normal', bullet: true, trucking: true, fatigue: true, injuries: false,
  ratings: 'real', weather: 'clear', aimCursor: 'fades', replays: 'big',
};

export const PRESETS: Record<'quick' | 'standard' | 'long', Partial<MatchConfig>> = {
  quick: { quarter: 1, difficulty: 'normal' },
  standard: { quarter: 3, difficulty: 'normal' },
  long: { quarter: 5, difficulty: 'hard' },
};

export const REAL_MINUTES: Record<number, number> = { 1: 8, 2: 12, 3: 15, 5: 19 };

export const DIFFICULTY: Record<Difficulty, { sackTime: number; coverLag: number; intRadius: number; aimFade: number }> = {
  easy: { sackTime: 4.0, coverLag: 0.45, intRadius: 0.8, aimFade: 0 },
  normal: { sackTime: 3.4, coverLag: 0.3, intRadius: 1.0, aimFade: 0.4 },
  hard: { sackTime: 2.9, coverLag: 0.2, intRadius: 1.2, aimFade: 0.7 },
  extreme: { sackTime: 2.5, coverLag: 0.12, intRadius: 1.4, aimFade: 1 },
};

/** The legal value list for each setting, used to validate setConfig and to draw the settings tab. */
export const CONFIG_OPTIONS: { [K in keyof MatchConfig]: readonly MatchConfig[K][] } = {
  quarter: [1, 2, 3, 5],
  playClock: [10, 15, 25],
  twoMinute: [true, false],
  timeouts: ['auto', 0, 1, 2, 3],
  defense: ['players', 'computer'],
  pauses: [0, 2, 5],
  reconnect: [1, 2, 5],
  difficulty: ['easy', 'normal', 'hard', 'extreme'],
  overtime: ['standard', 'sudden', 'off'],
  returns: ['live', 'touchback'],
  onside: [true, false],
  twoPoint: [true, false],
  penalties: [true, false],
  fumbles: ['off', 'normal', 'high'],
  bullet: [true, false],
  trucking: [true, false],
  fatigue: [true, false],
  injuries: [false, true],
  ratings: ['real', 'compressed', 'equal'],
  weather: ['clear', 'rain', 'snow', 'wind', 'random'],
  aimCursor: ['fades', 'full'],
  replays: ['off', 'big', 'all'],
};

export function isValidConfigPatch(patch: Partial<MatchConfig>): boolean {
  for (const [k, v] of Object.entries(patch)) {
    const opts = CONFIG_OPTIONS[k as keyof MatchConfig] as readonly unknown[] | undefined;
    if (!opts || !opts.includes(v)) return false;
  }
  return true;
}
