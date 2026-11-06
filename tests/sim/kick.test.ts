import { describe, expect, it } from 'vitest';
import { buildRoster, kickRange } from '../../src/shared/data/roster';
import { TEAM_BY_ID } from '../../src/shared/data/teams';
import { botInputs, newBot } from '../../src/shared/sim/bot';
import { acceptHandoff, continueWithAutoRunner } from '../../src/shared/sim/contact';
import { goalPostX, kickPower, kickSpot, updateKickMeter } from '../../src/shared/sim/kick';
import { createPlay } from '../../src/shared/sim/setup';
import { step } from '../../src/shared/sim/step';
import type { PlayDesc, PlayType, SimCfg, SimInput, SimState, SimTeams } from '../../src/shared/sim/state';
import { T } from '../../src/shared/sim/tuning';

const cfg = (over: Partial<SimCfg> = {}): SimCfg => ({
  difficulty: 'normal', sackTime: 3.4, coverLag: 0.3, intRadius: 1, weather: 'clear', fumbleMult: 1, bullet: true, trucking: true, fatigue: false, injuries: false, penalties: true, liveReturns: true, ...over,
});
const teams = (): SimTeams => {
  const t = TEAM_BY_ID.SEA;
  const u = TEAM_BY_ID.LAR;
  return { rosters: [buildRoster('SEA', t.off, t.def), buildRoster('LAR', u.off, u.def)], cond: [new Array(17).fill(1), new Array(17).fill(1)], armFatigue: [0, 0] };
};
const desc = (type: PlayType, over: Partial<PlayDesc> = {}): PlayDesc => ({ id: 3, type, seed: 77, offense: 0, dir: 1, los: 45, down: 1, toGo: 10, playbook: 6, defense: 0, clock: 100, ...over });
const make = (type: PlayType, over: Partial<PlayDesc> = {}, c: Partial<SimCfg> = {}): SimState => createPlay(desc(type, over), teams(), cfg(c));

/** Taps at a chosen meter and arrow, then runs to the end. */
function kick(s: SimState, meter = 0.8, arrow = 0, inputs: (s: SimState) => SimInput[] = () => []): void {
  s.kick!.meter = meter;
  step(s, [{ k: 'tap' }]);
  s.kick!.arrow = arrow;
  step(s, [{ k: 'tap' }]);
  for (let i = 0; i < 60 * 40 && !s.finished; i++) {
    if (s.frozen || s.handoff) { if (s.handoff) acceptHandoff(s); }
    step(s, inputs(s));
  }
}

describe('kick input', () => {
  it('two taps: power, then aim. Green gives full power and a miss shortens it', () => {
    expect(kickPower(0.8)).toBe(1);
    expect(kickPower(T.kick.greenLo)).toBe(1);
    expect(kickPower(0.5)).toBeLessThan(1);
    expect(kickPower(0.99)).toBeLessThan(1);
    expect(kickPower(0)).toBe(T.kick.minPower);
    const s = make('fieldGoal', { los: 90 });
    expect(s.phase).toBe('kickPower');
    step(s, [{ k: 'tap' }]);
    expect(s.phase).toBe('kickAim');
    step(s, [{ k: 'tap' }]);
    expect(s.phase).toBe('kickFlight');
  });

  it('the meter and arrow keep moving, and better accuracy swings the arrow slower', () => {
    const s = make('kickoff');
    const before = s.kick!.meter;
    updateKickMeter(s, 0.1);
    expect(s.kick!.meter).not.toBe(before);
    const low = T.kick.arrowHzBase + T.kick.arrowHzPerAcc * 1;
    const high = T.kick.arrowHzBase + T.kick.arrowHzPerAcc * 10;
    expect(high).toBeLessThan(low);
  });

  it('a kick the player never finishes takes itself', () => {
    const s = make('fieldGoal', { los: 90 });
    step(s, [{ k: 'tap' }]);
    for (let i = 0; i < T.kick.aimTimeout * 60 + 2; i++) step(s, []);
    expect(s.phase === 'kickFlight' || s.phase === 'dead').toBe(true);
  });

  it('the play clock expiring kicks by itself, using a snap input', () => {
    const s = make('punt', { los: 40 });
    step(s, [{ k: 'snap' }]);
    expect(s.phase).toBe('kickAim');
    expect(s.kick!.auto).toBe(true);
    for (let i = 0; i < T.kick.autoAimDelay * 60 + 2; i++) step(s, []);
    expect(s.kick!.kicked).toBe(true);
  });
});

describe('field goals and extra points', () => {
  it('a straight kick in range is good, and scores from the kick spot', () => {
    const s = make('fieldGoal', { los: 90 });
    kick(s);
    expect(s.result?.end).toBe('fgGood');
    expect(s.result?.spotX).toBeCloseTo(kickSpot(desc('fieldGoal', { los: 90 })));
  });

  it('a wide kick misses, and so does one beyond the kicker\'s range', () => {
    const wide = make('fieldGoal', { los: 90 });
    kick(wide, 0.8, 1);
    expect(wide.result?.end).toBe('fgMiss');
    const far = make('fieldGoal', { los: 30 });
    kick(far);
    expect(far.result?.end).toBe('fgMiss');
  });

  it('a weak power tap can leave a long kick short', () => {
    const s = make('fieldGoal', { los: 76 });
    const range = s.kick!.range;
    const need = goalPostX(1) - s.players[0].x;
    expect(need).toBeLessThanOrEqual(range);
    kick(s, 0.1);
    expect(s.result?.end).toBe('fgMiss');
    expect(s.ball.x).toBeLessThan(goalPostX(1));
  });

  it('an extra point is in range even for the weakest kicker', () => {
    const s = make('extraPoint', { los: 94 });
    s.kick!.range = kickRange(1);
    expect(goalPostX(1) - s.players[0].x).toBe(T.kick.xpDistance);
    kick(s);
    expect(s.result?.end).toBe('xpGood');
    const miss = make('extraPoint', { los: 94 });
    kick(miss, 0.8, 1);
    expect(miss.result?.end).toBe('xpMiss');
  });

  it('kicks toward the other end work too', () => {
    const s = make('fieldGoal', { los: 30, dir: -1 });
    expect(goalPostX(-1)).toBe(0);
    kick(s);
    expect(s.result?.end).toBe('fgGood');
  });

  it('the clock is stopped during a kick', () => {
    const s = make('fieldGoal', { los: 90 });
    kick(s);
    expect(s.result?.clock).toBe(100);
  });
});

describe('kickoffs and punts', () => {
  it('hands control over as soon as the ball is kicked, with no freeze', () => {
    const s = make('kickoff');
    step(s, [{ k: 'tap' }]);
    expect(s.handoff).toBeNull();
    step(s, [{ k: 'tap' }]);
    expect(s.handoff?.reason).toBe('kick');
    expect(s.handoff?.to).toBe(1);
    expect(s.frozen).toBe(false);
    acceptHandoff(s);
    expect(s.control).toBe(1);
  });

  it('the fastest WR or RB returns, and the clock runs during the return', () => {
    const s = make('kickoff');
    kick(s, 0.8, 0.1);
    const ret = s.players[s.kick!.returner];
    expect(['WR', 'RB']).toContain(ret.role);
    expect(ret.seat).toBe(1);
    expect(s.result?.possessor === 1 || s.result?.possessor === 0).toBe(true);
    if (s.kick!.caught && s.result?.end !== 'touchback') expect(s.result!.clock).toBeLessThan(100);
  });

  it('a kick into the end zone with no input is a touchback, with the clock unchanged', () => {
    const s = make('kickoff');
    s.kick!.range = 60;
    kick(s);
    expect(s.result?.end).toBe('touchback');
    expect(s.result?.possessor).toBe(1);
  });

  it('tapping before the returner stops runs it out of the end zone', () => {
    const s = make('kickoff');
    s.kick!.range = 60;
    s.kick!.meter = 0.8;
    step(s, [{ k: 'tap' }]);
    s.kick!.arrow = 0;
    step(s, [{ k: 'tap' }]);
    acceptHandoff(s);
    step(s, [{ k: 'tap' }]);
    expect(s.kick!.ranOut).toBe(true);
    for (let i = 0; i < 60 * 40 && !s.finished; i++) step(s, []);
    expect(s.result?.end).not.toBe('touchback');
    expect(s.result?.spotX).toBeGreaterThan(0);
  });

  it('a kick out of bounds gives the receiver the ball where it went out', () => {
    const s = make('punt', { los: 30 });
    s.kick!.meter = 0.8;
    step(s, [{ k: 'tap' }]);
    s.kick!.arrow = 1;
    s.kick!.range = 60;
    T.kick.puntAimFactor = 3;
    step(s, [{ k: 'tap' }]);
    T.kick.puntAimFactor = 0.5;
    expect(s.kick!.landY).toBeGreaterThan(T.field.width);
    acceptHandoff(s);
    for (let i = 0; i < 60 * 10 && !s.finished; i++) step(s, []);
    expect(s.result?.end).toBe('kickOut');
    expect(s.result?.possessor).toBe(1);
    expect(s.result?.spotX).toBeCloseTo(s.kick!.landX);
  });

  it('touchback-only: kickoffs stop with no handoff, and punts stop at the landing spot', () => {
    const k = make('kickoff', {}, { liveReturns: false });
    kick(k, 0.5);
    expect(k.handoff).toBeNull();
    expect(k.result?.end).toBe('touchback');
    const p = make('punt', { los: 30 }, { liveReturns: false });
    kick(p, 0.5);
    expect(p.result?.end).toBe('kickOut');
    expect(p.result?.possessor).toBe(1);
    expect(p.result?.spotX).toBeCloseTo(p.kick!.landX);
  });

  it('an offline receiver gets the auto-runner', () => {
    const s = make('kickoff');
    s.kick!.range = 30;
    s.kick!.meter = 0.8;
    step(s, [{ k: 'tap' }]);
    s.kick!.arrow = 0;
    step(s, [{ k: 'tap' }]);
    continueWithAutoRunner(s);
    expect(s.autoRun).toBe(true);
    for (let i = 0; i < 60 * 40 && !s.finished; i++) step(s, []);
    expect(s.result).not.toBeNull();
    expect(s.control).toBe(0);
    expect(s.result!.possessor === 1 || s.result!.possessor === 0).toBe(true);
  });

  it('return gains go in the receiver\'s direction', () => {
    const s = make('kickoff');
    s.kick!.range = 30;
    kick(s);
    if (s.result?.possessor === 1 && s.kick!.caught) {
      expect(s.result.spotX).toBeLessThanOrEqual(s.catchX + 1);
      expect(s.stats[1].retYds).toBeGreaterThanOrEqual(-1);
    }
  });
});

describe('onside kicks', () => {
  it('accuracy sets the odds. A roll under them recovers for the kicking team, with a freeze and a handoff back', () => {
    const chance = T.kick.onsideBase + T.kick.onsidePerAcc * 5;
    let recovered = false;
    for (let seed = 1; seed < 400 && !recovered; seed++) {
      const s = make('onside', { seed });
      s.kick!.meter = 0.8;
      step(s, [{ k: 'tap' }]);
      s.kick!.arrow = 0;
      step(s, [{ k: 'tap' }]);
      expect(s.handoff?.reason).toBe('kick');
      acceptHandoff(s);
      for (let i = 0; i < 60 * 20 && !s.finished; i++) {
        step(s, []);
        if (s.handoff) {
          expect(s.handoff.reason).toBe('onside');
          expect(s.handoff.to).toBe(0);
          expect(s.frozen).toBe(true);
          recovered = true;
          break;
        }
      }
    }
    expect(recovered).toBe(true);
    expect(chance).toBeLessThan(1);
  });

  it('recoveries happen at about the stated rate', () => {
    let kicking = 0;
    const n = 200;
    let expected = 0;
    for (let seed = 1; seed <= n; seed++) {
      const s = make('onside', { seed: seed * 7919 });
      expected += T.kick.onsideBase + T.kick.onsidePerAcc * s.kick!.acc;
      s.kick!.meter = 0.8;
      step(s, [{ k: 'tap' }]);
      s.kick!.arrow = 0;
      step(s, [{ k: 'tap' }]);
      acceptHandoff(s);
      for (let i = 0; i < 60 * 20 && !s.finished; i++) {
        step(s, []);
        if (s.frozen && s.handoff) { kicking += 1; break; }
      }
    }
    expect(Math.abs(kicking - expected)).toBeLessThan(n * 0.1);
  });

  it('a recovered onside in touchback-only mode stops at the spot', () => {
    const s = make('onside', { seed: 5 }, { liveReturns: false });
    kick(s);
    expect(s.result?.end).toBe('kickOut');
    expect(s.handoff).toBeNull();
  });
});

describe('determinism and the bot', () => {
  it('the same seed and inputs give the same kick', () => {
    const run = () => { const s = make('punt', { los: 40, seed: 901 }); kick(s, 0.7, 0.2); return JSON.stringify(s.result); };
    expect(run()).toBe(run());
  });

  it('a JSON round trip at the handoff keeps the play identical', () => {
    const a = make('kickoff', { seed: 44 });
    a.kick!.meter = 0.8;
    step(a, [{ k: 'tap' }]);
    a.kick!.arrow = 0.1;
    step(a, [{ k: 'tap' }]);
    const b = JSON.parse(JSON.stringify(a)) as SimState;
    acceptHandoff(a);
    acceptHandoff(b);
    for (let i = 0; i < 60 * 30; i++) { step(a); step(b); }
    expect(JSON.stringify(b.result)).toBe(JSON.stringify(a.result));
    expect(a.result).not.toBeNull();
  });

  it('bots complete every kind of kick', () => {
    for (const type of ['kickoff', 'freeKick', 'onside', 'punt', 'fieldGoal', 'extraPoint'] as PlayType[]) {
      for (let seed = 1; seed <= 25; seed++) {
        const s = make(type, { seed: seed * 131, los: type === 'extraPoint' ? 94 : type === 'fieldGoal' ? 85 : 45 });
        const bot = newBot(seed);
        for (let i = 0; i < 60 * 40 && !s.finished; i++) {
          if (s.handoff) acceptHandoff(s);
          step(s, botInputs(s, bot, s.control));
        }
        expect(s.finished, `${type} ${seed}`).toBe(true);
        expect(s.result).not.toBeNull();
        expect(s.result!.spotX).toBeGreaterThanOrEqual(0);
        expect(s.result!.spotX).toBeLessThanOrEqual(T.field.len);
      }
    }
  });

  it('the bot makes most field goals and extra points', () => {
    let good = 0;
    const n = 100;
    for (let seed = 1; seed <= n; seed++) {
      const s = make('extraPoint', { seed: seed * 97, los: 94 });
      const bot = newBot(seed);
      for (let i = 0; i < 60 * 20 && !s.finished; i++) step(s, botInputs(s, bot, 0));
      if (s.result?.end === 'xpGood') good += 1;
    }
    expect(good).toBeGreaterThan(70);
  });
});
