// One test per match setting, showing that it changes what it says. Server timers are in tests/room/.
import { describe, expect, it } from 'vitest';
import { CONFIG_OPTIONS, DEFAULT_CONFIG, DIFFICULTY, PRESETS, realMinutes, type MatchConfig } from '../../src/shared/data/config';
import { adjustScore, buildRoster } from '../../src/shared/data/roster';
import { TEAM_BY_ID, TEAMS } from '../../src/shared/data/teams';
import { quarterSeconds, runoffSeconds, timeoutsPerHalf, twoMinuteMark } from '../../src/shared/rules/clock';
import { afterCoinToss, applyChoice, applyResult, applySnap, applyTimeout, clockRunningNow, createMatch, effectiveRoster, expireClock, isChoiceLegal, isResultValid, runClock, simContext, type MatchState } from '../../src/shared/rules/match';
import { acceptHandoff, fumbleChance, requestHandoff } from '../../src/shared/sim/contact';
import { catchChance } from '../../src/shared/sim/pass';
import { aimFadeAlpha, launch } from '../../src/shared/sim/pass';
import { carrierSpeed } from '../../src/shared/sim/run';
import { createPlay } from '../../src/shared/sim/setup';
import { step } from '../../src/shared/sim/step';
import type { PlayDesc, SimState } from '../../src/shared/sim/state';
import { T } from '../../src/shared/sim/tuning';
import { inPlay, match, result } from './helpers';

const play = (over: Partial<MatchConfig> = {}, seed = 12, type: PlayDesc['type'] = 'scrimmage', playbook = 6): SimState => {
  const m = match(over);
  const ctx = simContext(m);
  return createPlay({ id: 1, type, seed, offense: 0, dir: 1, los: 50, down: 1, toGo: 10, playbook, defense: 0, clock: 100 }, ctx.teams, ctx.cfg);
};
const snapped = (over: Partial<MatchConfig> = {}): SimState => { const s = play(over); step(s, [{ k: 'snap' }]); return s; };

describe('time settings', () => {
  it('quarter length sets the clock, the runoff, the warning and the timeouts', () => {
    const want: Record<number, [number, number, number, number]> = { 1: [60, 4, 30, 2], 2: [120, 8, 60, 2], 3: [180, 12, 120, 3], 5: [300, 20, 120, 3] };
    for (const q of CONFIG_OPTIONS.quarter) {
      const m = match({ quarter: q });
      expect([quarterSeconds(m), runoffSeconds(m), twoMinuteMark(m), timeoutsPerHalf(m)]).toEqual(want[q]);
      expect(m.clock).toBe(q * 60);
    }
  });

  it('timeouts per half: Auto follows the quarter length, and a number overrides it', () => {
    expect(match({ timeouts: 'auto', quarter: 1 }).timeouts).toEqual([2, 2]);
    expect(match({ timeouts: 'auto', quarter: 5 }).timeouts).toEqual([3, 3]);
    for (const n of [0, 1, 2, 3] as const) expect(match({ timeouts: n }).timeouts).toEqual([n, n]);
  });

  it('the two-minute warning fires only when on', () => {
    const run = (twoMinute: boolean) => {
      const m = inPlay({ twoMinute, quarter: 3 }, { period: 2, clock: 123 });
      return applyResult(applySnap(m), result(m, 'incomplete', 50, { clock: 119 }));
    };
    expect(run(true).banner?.kind).toBe('twoMin');
    expect(run(false).banner?.kind).not.toBe('twoMin');
  });

  it('game clock: Runs keeps going after an incomplete pass, and counts real time instead of the runoff', () => {
    const after = (clock: MatchConfig['clock'], end: 'incomplete' | 'tackle') => {
      const m = inPlay({ clock });
      return applyResult(applySnap(m), result(m, end, 55, { clock: m.clock - 5 }));
    };
    expect(after('stops', 'incomplete').runoffPending).toBe(false);
    const stopsTackle = after('stops', 'tackle');
    expect(applySnap(stopsTackle).clock).toBe(stopsTackle.clock - runoffSeconds(stopsTackle));

    const runs = after('runs', 'incomplete');
    expect(clockRunningNow(runs)).toBe(true);
    const later = runClock(runs, 9);
    expect(later.clock).toBeCloseTo(runs.clock - 9);
    expect(later.stats[later.possession].top).toBeCloseTo(runs.stats[runs.possession].top + 9);
    // The room has already counted the time, so the snap takes nothing more.
    expect(applySnap(later).clock).toBeCloseTo(later.clock);
    // A stopped clock ignores real time.
    expect(runClock(after('stops', 'incomplete'), 9).clock).toBe(after('stops', 'incomplete').clock);
    expect(CONFIG_OPTIONS.clock).toEqual(['stops', 'runs']);
  });

  it('game clock: a timeout stops a running clock until the snap', () => {
    const m = inPlay({ clock: 'runs' });
    const huddle = applyResult(applySnap(m), result(m, 'tackle', 55, { clock: m.clock - 5 }));
    expect(huddle.phase).toBe('huddle');
    const stopped = applyTimeout({ ...huddle, timeouts: [3, 3] }, 0);
    expect(clockRunningNow(stopped)).toBe(false);
    expect(runClock(stopped, 9).clock).toBe(stopped.clock);
  });

  it('game clock: a running clock that reaches 0:00 between plays ends the quarter, but a conversion is still played', () => {
    const m = inPlay({ clock: 'runs', quarter: 1 });
    const huddle = applyResult(applySnap(m), result(m, 'tackle', 55, { clock: 3 }));
    const out = expireClock(runClock(huddle, 5));
    expect([out.period, out.phase, out.banner?.kind, out.clock, out.play]).toEqual([2, 'banner', 'quarter', 60, null]);

    const td = applyResult(applySnap(m), result(m, 'td', 112, { clock: 2 }));
    expect(td.after.k).toBe('conversion');
    const late = expireClock(runClock(td, 5));
    expect([late.period, late.phase, late.clock, clockRunningNow(late)]).toEqual([1, td.phase, 0, false]);

    // The halftime and the end of the game come the same way.
    expect(expireClock(runClock({ ...huddle, period: 2 }, 5)).banner?.kind).toBe('half');
    expect(expireClock(runClock({ ...huddle, period: 4, score: [7, 0] }, 5)).phase).toBe('final');
    // A stopped clock never runs out this way.
    expect(expireClock({ ...huddle, config: { ...huddle.config, clock: 'stops' }, clock: 0 }).period).toBe(1);
  });

  it('game clock: a running clock lets the result read up to the slack above the room, and never winds back up', () => {
    const m = applySnap(inPlay({ clock: 'runs' }));
    expect(isResultValid(m, result(m, 'tackle', 55, { clock: m.clock + T.clock.snapSlack - 0.1 }))).toBe(true);
    expect(isResultValid(m, result(m, 'tackle', 55, { clock: m.clock + T.clock.snapSlack + 0.1 }))).toBe(false);
    expect(applyResult(m, result(m, 'tackle', 55, { clock: m.clock + 0.5 })).clock).toBe(m.clock);
    const stops = applySnap(inPlay());
    expect(isResultValid(stops, result(stops, 'tackle', 55, { clock: stops.clock + 0.5 }))).toBe(false);
  });

  it('pauses per player set their pools', () => {
    for (const n of CONFIG_OPTIONS.pauses) expect(match({ pauses: n }).pauses).toEqual([n, n]);
  });
  it('defense calls: players call their own, or the computer calls one at once', () => {
    const open = (defense: 'players' | 'computer') => {
      const m = inPlay({ defense });
      return applyTimeout({ ...m, phase: 'presnap', timeouts: [3, 3] }, 0);
    };
    const players = open('players');
    expect(players.phase).toBe('huddle');
    expect(players.huddle?.computer).toBe(false);
    expect(players.huddle?.calls).toEqual([-1, -1]);
    const computer = open('computer');
    expect(computer.huddle?.computer).toBe(true);
    expect(computer.huddle?.calls[1]).toBeGreaterThanOrEqual(0);
    expect(CONFIG_OPTIONS.defense).toEqual(['players', 'computer']);
  });
});

describe('rules settings', () => {
  it('difficulty feeds the AI defense table', () => {
    for (const d of CONFIG_OPTIONS.difficulty) {
      const c = simContext(match({ difficulty: d })).cfg;
      expect([c.sackTime, c.coverLag, c.intRadius]).toEqual([DIFFICULTY[d].sackTime, DIFFICULTY[d].coverLag, DIFFICULTY[d].intRadius]);
    }
    expect(DIFFICULTY.easy.sackTime).toBeGreaterThan(DIFFICULTY.extreme.sackTime);
  });

  it('overtime: off lets ties stand, and the others play on', () => {
    const tied = (overtime: MatchConfig['overtime']) => {
      const m = inPlay({ overtime }, { period: 4, clock: 2, score: [7, 7] });
      return applyResult(applySnap(m), result(m, 'tackle', 52, { clock: 0 }));
    };
    expect(tied('off').phase).toBe('final');
    expect(tied('off').winner).toBe('tie');
    expect(tied('standard').period).toBe(5);
    expect(tied('standard').ot?.stage).toBe('first');
    expect(tied('sudden').ot?.stage).toBe('sudden');
  });

  it('kick returns: live hands off, and touchback-only never does', () => {
    expect(simContext(match({ returns: 'live' })).cfg.liveReturns).toBe(true);
    expect(simContext(match({ returns: 'touchback' })).cfg.liveReturns).toBe(false);
  });

  it('onside kicks are offered only when on, and only when tied or trailing', () => {
    expect(afterCoinToss(match({ onside: true })).phase).toBe('kickChoice');
    expect(afterCoinToss(match({ onside: false })).phase).toBe('presnap');
  });

  it('two-point tries: off skips the conversion choice', () => {
    const score = (twoPoint: boolean) => {
      const m = inPlay({ twoPoint }, { ballX: 105 });
      return applyResult(applySnap(m), result(m, 'td', 110));
    };
    expect(score(true).phase).toBe('conversion');
    expect(isChoiceLegal(score(true), 'two')).toBe(true);
    const off = score(false);
    expect(off.phase).toBe('presnap');
    expect(off.play?.type).toBe('extraPoint');
  });

  it('penalties: pass interference is never flagged when off', () => {
    const count = (penalties: boolean) => {
      let flags = 0;
      for (let seed = 1; seed < 500; seed++) {
        const s = play({ penalties }, seed);
        step(s, [{ k: 'snap' }]);
        for (let i = 0; i < 60; i++) step(s, []);
        const r = s.players[2];
        // A ball thrown with a defender right on the receiver.
        s.players[13].x = r.x; s.players[13].y = r.y;
        launch(s, r.x - s.players[0].x, r.y - s.players[0].y, false);
        for (let i = 0; i < 200 && s.phase === 'flight'; i++) { s.players[13].x = s.players[2].x; s.players[13].y = s.players[2].y; step(s, []); }
        if (s.pass?.piFlag) flags += 1;
      }
      return flags;
    };
    expect(count(false)).toBe(0);
    expect(count(true)).toBeGreaterThan(0);
  });

  it('fumbles: off is never, and high doubles normal', () => {
    expect(simContext(match({ fumbles: 'off' })).cfg.fumbleMult).toBe(0);
    expect(simContext(match({ fumbles: 'normal' })).cfg.fumbleMult).toBe(1);
    expect(simContext(match({ fumbles: 'high' })).cfg.fumbleMult).toBe(T.contact.fumbleHighMult);
    expect(fumbleChance(5, false, false, false, 0)).toBe(0);
    expect(fumbleChance(5, false, false, false, 2)).toBeCloseTo(2 * fumbleChance(5, false, false, false, 1));
  });

  it('bullet passes: the input does nothing when off', () => {
    for (const [bullet, want] of [[true, true], [false, false]] as const) {
      const s = snapped({ bullet });
      step(s, [{ k: 'aimStart' }]);
      step(s, [{ k: 'bullet' }]);
      expect(s.aim.bullet).toBe(want);
    }
  });

  it('trucking: the input does nothing when off', () => {
    for (const [trucking, want] of [[true, true], [false, false]] as const) {
      const s = snapped({ trucking });
      step(s, [{ k: 'qbRun' }]);
      step(s, [{ k: 'truck', on: true }]);
      expect(s.g.truck).toBe(want);
    }
  });

  it('fatigue: off ignores stamina, worn condition and a tired arm', () => {
    const worn = (fatigue: boolean) => {
      const m: MatchState = { ...match({ fatigue }), condition: [new Array(17).fill(0.2), new Array(17).fill(0.2)], armFatigue: [0.2, 0.2] };
      const ctx = simContext(m);
      return { s: createPlay({ id: 1, type: 'scrimmage', seed: 3, offense: 0, dir: 1, los: 50, down: 1, toGo: 10, playbook: 6, defense: 0, clock: 100 }, ctx.teams, ctx.cfg) };
    };
    const on = worn(true).s;
    const off = worn(false).s;
    expect(on.players[1].cond).toBe(0.2);
    expect(off.players[1].cond).toBe(1);
    expect(on.armRange).toBeLessThan(off.armRange);
    on.players[1].ran = 200;
    off.players[1].ran = 200;
    expect(carrierSpeed(on, on.players[1])).toBeLessThan(carrierSpeed(off, off.players[1]));
  });

  it('injuries: a hurt player is replaced by a backup rated 2 lower, and off never injures', () => {
    const m = inPlay({ injuries: true });
    const before = effectiveRoster(m, 0)[1].attrs.spd;
    const a = applyResult(applySnap(m), result(m, 'tackle', 55, { injury: [0, 1] }));
    expect(a.injured[0]).toContain(1);
    expect(effectiveRoster(a, 0)[1].attrs.spd).toBeCloseTo(Math.max(T.attr.min, before - T.attr.backupPenalty));
    const hurtIn = (injuries: boolean) => {
      let hurt = 0;
      const saved = T.run.injuryChance;
      T.run.injuryChance = 0.5;
      for (let seed = 1; seed <= 120; seed++) {
        // HB Dive: the back takes the handoff and carries into traffic.
        const s = play({ injuries }, seed, 'scrimmage', 0);
        step(s, [{ k: 'snap' }]);
        for (let i = 0; i < 1500 && !s.finished; i++) { if (s.frozen) acceptHandoff(s); step(s, []); }
        if (s.injury) hurt += 1;
      }
      T.run.injuryChance = saved;
      return hurt;
    };
    expect(hurtIn(false)).toBe(0);
    expect(hurtIn(true)).toBeGreaterThan(0);
  });
});

describe('teams and conditions settings', () => {
  it('team ratings: real keeps the score, compressed halves its distance from 80, and equal sets 80', () => {
    expect(adjustScore(99, 'real')).toBe(99);
    expect(adjustScore(99, 'compressed')).toBeCloseTo(89.5);
    expect(adjustScore(60, 'compressed')).toBe(70);
    expect(adjustScore(60, 'equal')).toBe(80);
    const m = createMatch({ ...DEFAULT_CONFIG, ratings: 'equal' }, ['SEA', 'DAL'], 1);
    expect(m.scores).toEqual([[80, 80], [80, 80]]);
  });

  it('weather: each type has its catch and fumble effects, and random picks one by seed', () => {
    const base = catchChance(5, 1, false, 'clear', false);
    expect(catchChance(5, 1, false, 'rain', false)).toBeCloseTo(base - 0.1);
    expect(catchChance(5, 1, false, 'snow', false)).toBeCloseTo(base - 0.15);
    expect(catchChance(5, 1, false, 'wind', false)).toBeCloseTo(base - 0.05);
    expect(fumbleChance(5, false, true, false)).toBeCloseTo(fumbleChance(5, false, false, false) + T.contact.fumbleWet);
    for (const w of ['clear', 'rain', 'snow', 'wind'] as const) expect(match({ weather: w }).weather).toBe(w);
    const seen = new Set<string>();
    for (let seed = 1; seed < 80; seed++) seen.add(match({ weather: 'random' }, seed).weather);
    expect([...seen].sort()).toEqual(['clear', 'rain', 'snow', 'wind']);
  });

  it('wind pushes passes and kicks off line, and clear does not', () => {
    const spread = (weather: MatchConfig['weather']) => {
      const ends = new Set<number>();
      for (let seed = 1; seed < 20; seed++) {
        const s = play({ weather }, seed, 'fieldGoal');
        s.kick!.meter = 0.8;
        step(s, [{ k: 'tap' }]);
        s.kick!.arrow = 0;
        step(s, [{ k: 'tap' }]);
        ends.add(Math.round(s.kick!.landY * 100));
      }
      return ends.size;
    };
    expect(spread('clear')).toBe(1);
    expect(spread('wind')).toBeGreaterThan(1);
  });

  it('aim cursor: always full ignores fade, and fades follows difficulty and QB accuracy', () => {
    const fades = (difficulty: MatchConfig['difficulty']) => aimFadeAlpha(play({ difficulty }), false);
    expect(fades('easy')).toBe(1);
    expect(fades('extreme')).toBeLessThan(fades('normal'));
    expect(aimFadeAlpha(play({ difficulty: 'extreme' }), true)).toBe(1);
  });
});

describe('presets and data', () => {
  it('presets match the plan, plus Sprint, and each one sets the same keys', () => {
    expect(PRESETS.quick.quarter).toBe(1);
    expect(PRESETS.standard.quarter).toBe(3);
    expect(PRESETS.long).toMatchObject({ quarter: 5, difficulty: 'hard', clock: 'stops' });
    expect(PRESETS.sprint).toEqual({ quarter: 1, clock: 'runs', twoMinute: false, overtime: 'sudden', difficulty: 'normal' });
    const keys = Object.keys(PRESETS.sprint).sort();
    for (const p of Object.values(PRESETS)) expect(Object.keys(p).sort()).toEqual(keys);
    // Standard is the default for every key it sets.
    for (const [k, v] of Object.entries(PRESETS.standard)) expect(DEFAULT_CONFIG[k as keyof MatchConfig]).toBe(v);
    expect(realMinutes({ ...DEFAULT_CONFIG, ...PRESETS.sprint })).toBe(6);
    expect(realMinutes({ ...DEFAULT_CONFIG, ...PRESETS.quick })).toBe(8);
  });

  it('every default is one of its own options', () => {
    for (const k of Object.keys(CONFIG_OPTIONS) as (keyof MatchConfig)[]) expect(CONFIG_OPTIONS[k] as readonly unknown[]).toContain(DEFAULT_CONFIG[k]);
  });

  it('team colours are valid and a team\'s two colours differ', () => {
    for (const t of TEAMS) {
      expect(t.primary).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.secondary).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.primary).not.toBe(t.secondary);
    }
    expect(TEAM_BY_ID.SEA).toBeDefined();
  });

  it('kits: the same team twice, or close colours, puts the second player in white', () => {
    expect(createMatch(DEFAULT_CONFIG, ['SEA', 'SEA'], 1).away).toEqual([false, true]);
    expect(createMatch(DEFAULT_CONFIG, ['SEA', 'KC'], 1).away).toEqual([false, false]);
    expect(createMatch(DEFAULT_CONFIG, ['TEN', 'DAL'], 1).away).toEqual([false, true]);
  });

  it('the roster is the same every match, and stays within 1 to 10', () => {
    const a = buildRoster('SEA', 94, 99);
    expect(buildRoster('SEA', 94, 99)).toEqual(a);
    for (const p of a) for (const v of Object.values(p.attrs)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); }
    expect(a.filter((p) => p.star).length).toBe(1);
  });

  it('applyChoice keeps a play legal for every 4th-down option', () => {
    const m = inPlay({}, { down: 4, toGo: 3, ballX: 80, phase: 'choice4th' });
    for (const c of ['go', 'punt', 'fg'] as const) expect(applyChoice({ ...m, phase: 'choice4th', play: null }, c).phase).toBe(c === 'go' ? 'huddle' : 'presnap');
    void requestHandoff;
  });
});
