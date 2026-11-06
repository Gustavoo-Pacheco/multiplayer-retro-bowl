// Match settings, their defaults, and presets.
export interface MatchConfig {
  quarter: 1 | 2 | 3 | 5;
  /** Stops: the clock stops between plays as usual. Runs: it keeps running in real time between plays, stopping only for timeouts, pauses, the two-minute warning and quarter breaks. */
  clock: 'stops' | 'runs';
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
  quarter: 3, clock: 'stops', playClock: 15, twoMinute: true, timeouts: 'auto', defense: 'players', pauses: 2, reconnect: 2,
  difficulty: 'normal', overtime: 'standard', returns: 'live', onside: true, twoPoint: true, penalties: true,
  fumbles: 'normal', bullet: true, trucking: true, fatigue: true, injuries: false,
  ratings: 'real', weather: 'clear', aimCursor: 'fades', replays: 'big',
};

export type PresetId = 'sprint' | 'quick' | 'standard' | 'long';

/** Every preset sets the same keys, so picking one fully replaces another. */
export const PRESETS: Record<PresetId, Partial<MatchConfig>> = {
  sprint: { quarter: 1, clock: 'runs', twoMinute: false, overtime: 'sudden', difficulty: 'normal' },
  quick: { quarter: 1, clock: 'stops', twoMinute: true, overtime: 'standard', difficulty: 'normal' },
  standard: { quarter: 3, clock: 'stops', twoMinute: true, overtime: 'standard', difficulty: 'normal' },
  long: { quarter: 5, clock: 'stops', twoMinute: true, overtime: 'standard', difficulty: 'hard' },
};

export const REAL_MINUTES: Record<number, number> = { 1: 8, 2: 12, 3: 15, 5: 19 };
/** With a running clock. Estimated from bot games through the real rules and the room's timers, allowing about 4 s to call a play and 2.5 s at the line. */
export const REAL_MINUTES_RUNNING: Record<number, number> = { 1: 6, 2: 11, 3: 16, 5: 25 };

export function realMinutes(c: MatchConfig): number {
  return (c.clock === 'runs' ? REAL_MINUTES_RUNNING : REAL_MINUTES)[c.quarter] ?? 15;
}

export const DIFFICULTY: Record<Difficulty, { sackTime: number; coverLag: number; intRadius: number; aimFade: number }> = {
  easy: { sackTime: 4.0, coverLag: 0.45, intRadius: 0.8, aimFade: 0 },
  normal: { sackTime: 3.4, coverLag: 0.3, intRadius: 1.0, aimFade: 0.4 },
  hard: { sackTime: 2.9, coverLag: 0.2, intRadius: 1.2, aimFade: 0.7 },
  extreme: { sackTime: 2.5, coverLag: 0.12, intRadius: 1.4, aimFade: 1 },
};

/** The legal value list for each setting, used to validate setConfig and to draw the settings tab. */
export const CONFIG_OPTIONS: { [K in keyof MatchConfig]: readonly MatchConfig[K][] } = {
  quarter: [1, 2, 3, 5],
  clock: ['stops', 'runs'],
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
