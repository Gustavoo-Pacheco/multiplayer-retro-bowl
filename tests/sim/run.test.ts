import { describe, expect, it } from 'vitest';
import { runPlays } from '../../tools/balance';
import { acceptHandoff, continueWithAutoRunner, fumble, fumbleChance, takeBall } from '../../src/shared/sim/contact';
import { beginRun } from '../../src/shared/sim/run';
import { step } from '../../src/shared/sim/step';
import { T } from '../../src/shared/sim/tuning';
import type { SimInput, SimState } from '../../src/shared/sim/state';
import { play } from './helpers';

function stepN(s: SimState, n: number, inputs: SimInput[] = []): void {
  step(s, inputs);
  for (let i = 1; i < n; i++) step(s);
}

/** A handed-off RB, with the defenders pushed out of the way. */
function runner(over = {}): SimState {
  const s = play(over);
  stepN(s, 2, [{ k: 'snap' }]);
  step(s, [{ k: 'handoff' }]);
  for (const p of s.players) if (p.seat !== s.desc.offense) { p.x = 110; p.y = 1 + p.i * 0.5; p.job = 'idle'; }
  s.players[1].route = null;
  return s;
}

describe('handoff and QB run', () => {
  it('a tap on the RB in the window hands off', () => {
    const s = play();
    stepN(s, 2, [{ k: 'snap' }]);
    step(s, [{ k: 'handoff' }]);
    expect(s.phase).toBe('run');
    expect(s.ball.holder).toBe(1);
    expect(s.ran).toBe(true);
  });
  it('a handoff after 1.2 seconds is ignored', () => {
    const s = play();
    stepN(s, 2, [{ k: 'snap' }]);
    stepN(s, Math.ceil(T.pocket.handoffWindow * T.hz) + 2);
    step(s, [{ k: 'handoff' }]);
    expect(s.ball.holder).toBe(0);
  });
  it('a QB run ends any chance to throw', () => {
    const s = play();
    stepN(s, 2, [{ k: 'snap' }]);
    step(s, [{ k: 'qbRun' }]);
    expect(s.phase).toBe('run');
    expect(s.ball.holder).toBe(0);
    step(s, [{ k: 'aimStart' }]);
    expect(s.aim.on).toBe(false);
  });
});

describe('runner gestures', () => {
  it('moves forward with no input', () => {
    const s = runner();
    const x0 = s.players[1].x;
    stepN(s, 30);
    expect(s.players[1].x).toBeGreaterThan(x0 + 2);
  });
  it('a swipe up or down jukes', () => {
    const s = runner();
    const y0 = s.players[1].y;
    stepN(s, 12, [{ k: 'swipe', dx: 0, dy: -30 }]);
    expect(s.players[1].y).toBeLessThan(y0 - 0.5);
  });
  it('repeating a juke within 1.5 seconds cuts speed by 10%', () => {
    const s = runner();
    step(s, [{ k: 'swipe', dx: 0, dy: -30 }]);
    expect(s.g.jukeLoss).toBe(0);
    stepN(s, 25);
    step(s, [{ k: 'swipe', dx: 0, dy: 30 }]);
    expect(s.g.jukeLoss).toBeCloseTo(T.run.jukeRepeatLoss, 2);
  });
  it('a swipe forward dives for 1 to 2 yards and ends the play', () => {
    const s = runner();
    stepN(s, 10);
    const x0 = s.players[1].x;
    step(s, [{ k: 'swipe', dx: 30, dy: 0 }]);
    expect(s.g.diveT).toBeGreaterThan(0);
    stepN(s, 40);
    expect(s.phase).toBe('dead');
    expect(s.result!.end).toBe('tackle');
    const gained = s.result!.spotX - x0;
    expect(gained).toBeGreaterThanOrEqual(T.run.diveLo - 0.2);
    expect(gained).toBeLessThanOrEqual(T.run.diveHi + 0.2);
  });
  it('a swipe backward slows down', () => {
    const s = runner();
    stepN(s, 20);
    step(s, [{ k: 'swipe', dx: -30, dy: 0 }]);
    expect(s.g.slowT).toBeGreaterThan(0);
    stepN(s, 15);
    expect(Math.abs(s.players[1].vx)).toBeLessThan(s.players[1].top * 0.7);
  });
  it('a swipe toward a defender within 2 yards stiff-arms, limited by strength', () => {
    const s = runner();
    const rb = s.players[1];
    rb.str = 7;
    beginRunAgain(s);
    const left = s.g.stiffsLeft;
    expect(left).toBe(2);
    const d = s.players[8];
    d.x = rb.x + 1.5; d.y = rb.y; d.tackleCd = 5;
    step(s, [{ k: 'swipe', dx: 30, dy: 0 }]);
    expect(s.g.stiffT).toBeGreaterThan(0);
    expect(s.g.stiffsLeft).toBe(left - 1);
  });
  it('holding still trucks: slower, with a filling meter', () => {
    const s = runner();
    stepN(s, 20);
    step(s, [{ k: 'truck', on: true }]);
    stepN(s, 30);
    expect(s.g.truck).toBe(true);
    expect(s.g.truckMeter).toBeGreaterThan(0.3);
    expect(Math.abs(s.players[1].vx)).toBeLessThan(s.players[1].top * 0.9);
    step(s, [{ k: 'truck', on: false }]);
    expect(s.g.truck).toBe(false);
  });
  it('the trucking setting turns it off', () => {
    const s = runner();
    s.cfg.trucking = false;
    step(s, [{ k: 'truck', on: true }]);
    expect(s.g.truck).toBe(false);
  });
  it('a touchdown ends the play at the goal line', () => {
    const s = runner({ los: 105 });
    stepN(s, 120);
    expect(s.result?.end).toBe('td');
  });
  it('running out of bounds ends the play', () => {
    const s = runner();
    s.players[1].y = 0.2;
    for (let i = 0; i < 20 && s.phase !== 'dead'; i++) step(s, [{ k: 'swipe', dx: 0, dy: -30 }]);
    expect(s.result?.end).toBe('oob');
  });
});

function beginRunAgain(s: SimState): void { beginRun(s); }

describe('contact', () => {
  it('fumble odds match the plan', () => {
    expect(fumbleChance(10, false, false, false)).toBeCloseTo(T.chance.min);
    expect(fumbleChance(5, false, false, false)).toBeCloseTo(0.03);
    expect(fumbleChance(5, true, true, true)).toBeCloseTo(0.03 + 0.01 + 0.005 + 0.02);
    expect(fumbleChance(5, false, false, false, 2)).toBeCloseTo(0.06);
    expect(fumbleChance(5, false, false, false, 0)).toBe(0);
  });
  it('sampled tackle outcomes fall within the formula', () => {
    let tackled = 0;
    const n = 1500;
    for (let i = 0; i < n; i++) {
      const s = runner({ seed: i + 1 });
      const rb = s.players[1];
      const d = s.players[8];
      s.cfg.fumbleMult = 0;
      rb.str = 5; d.tck = 5; rb.vx = 0; rb.vy = 0;
      d.x = rb.x; d.y = rb.y + 0.5; d.job = 'idle';
      stepN(s, 1);
      if (s.phase === 'dead') tackled += 1;
    }
    expect(Math.abs(tackled / n - 0.5)).toBeLessThan(0.05);
  });
  it('backward contact spots the ball where the receiver ends up', () => {
    let backward = 0;
    for (let seed = 1; seed < 200 && !backward; seed++) {
      const s = runner({ seed });
      s.cfg.fumbleMult = 0;
      const rb = s.players[1];
      stepN(s, 30);
      const d = s.players[9];
      d.job = 'idle'; d.x = rb.x + 0.6; d.y = rb.y;
      const xBefore = rb.x;
      for (let i = 0; i < 2 && s.phase !== 'dead'; i++) step(s);
      if (s.phase === 'dead' && s.result!.spotX < xBefore) {
        backward += 1;
        expect(s.result!.spotX).toBeCloseTo(rb.x, 5);
        expect(s.result!.yards).toBe(Math.round(rb.x - s.desc.los));
      }
    }
    expect(backward).toBe(1);
  });
  it('a recovered own fumble needs no handoff', () => {
    const s = runner();
    const rb = s.players[1];
    fumble(s, rb, null);
    expect(s.phase).toBe('loose');
    takeBall(s, s.players[2], 'fumble');
    expect(s.possessor).toBe(0);
    expect(s.handoff).toBeNull();
    expect(s.frozen).toBe(false);
    expect(s.stats[0].fumLost).toBe(0);
  });
  it('a lost fumble freezes and asks for a handoff, and the state then carries on', () => {
    const s = runner();
    const rb = s.players[1];
    fumble(s, rb, null);
    const d = s.players[10];
    d.x = 60; d.y = 8;
    takeBall(s, d, 'fumble');
    expect(s.handoff?.to).toBe(1);
    expect(s.frozen).toBe(true);
    const tick = s.tick;
    step(s);
    expect(s.tick).toBe(tick);
    const copy = JSON.parse(JSON.stringify(s)) as SimState;
    acceptHandoff(copy);
    expect(copy.control).toBe(1);
    step(copy);
    expect(copy.tick).toBe(tick + 1);
    continueWithAutoRunner(s);
    expect(s.control).toBe(0);
    expect(s.autoRun).toBe(true);
    step(s);
    expect(s.tick).toBe(tick + 1);
  });
  it('a watcher-offline auto-runner keeps a lost fumble moving', () => {
    const s = runner();
    fumble(s, s.players[1], null);
    const d = s.players[10];
    d.x = 60; d.y = 8;
    takeBall(s, d, 'fumble');
    continueWithAutoRunner(s);
    const x0 = d.x;
    stepN(s, 60);
    expect(d.x).toBeLessThan(x0); // defense runs the other way
  });
  it('an interception then a fumble back to the original team gives two handoffs', () => {
    const s = play();
    stepN(s, 2, [{ k: 'snap' }]);
    s.phase = 'flight';
    s.ball.holder = -1;
    const d = s.players[13];
    takeBall(s, d, 'int');
    expect(s.handoff?.to).toBe(1);
    acceptHandoff(s);
    expect(s.control).toBe(1);
    fumble(s, d, null);
    takeBall(s, s.players[2], 'fumble');
    expect(s.handoff?.to).toBe(0);
    acceptHandoff(s);
    expect(s.control).toBe(0);
    expect(s.possessor).toBe(0);
  });
  it('a pick in the defender\'s own end zone waits, then becomes a touchback without input', () => {
    const s = play({ los: 105 });
    stepN(s, 2, [{ k: 'snap' }]);
    const d = s.players[13];
    d.x = 115; d.y = 8;
    s.ball.holder = -1;
    s.phase = 'flight';
    takeBall(s, d, 'int');
    acceptHandoff(s);
    expect(s.ezWait).toBeGreaterThan(0);
    stepN(s, Math.ceil(T.kick.ezWindow * T.hz) + 2);
    expect(s.result?.end).toBe('touchback');
    expect(s.result?.possessor).toBe(1);
  });
  it('tapping during the wait runs the pick out', () => {
    const s = play({ los: 105 });
    stepN(s, 2, [{ k: 'snap' }]);
    const d = s.players[13];
    d.x = 115; d.y = 8;
    s.ball.holder = -1;
    s.phase = 'flight';
    takeBall(s, d, 'int');
    acceptHandoff(s);
    for (const p of s.players) if (p.seat === 0) { p.x = 20; p.job = 'idle'; }
    step(s, [{ k: 'tap' }]);
    expect(s.ezWait).toBe(0);
    stepN(s, 60);
    expect(d.x).toBeLessThan(110);
  });
  it('a turnover on a two-point try ends it at once', () => {
    const s = play({ type: 'twoPoint', los: 108 });
    stepN(s, 2, [{ k: 'snap' }]);
    s.ball.holder = -1;
    s.phase = 'flight';
    takeBall(s, s.players[13], 'int');
    expect(s.result?.end).toBe('tryFailed');
  });
});

describe('bot play', () => {
  it('1,000 plays give believable gains', () => {
    const a = runPlays(1000, 80, 80);
    expect(a.plays).toBe(1000);
    const ypp = a.yards / a.plays;
    expect(ypp).toBeGreaterThan(2);
    expect(ypp).toBeLessThan(12);
    expect(a.runYds / a.runs).toBeGreaterThan(1);
    expect(a.comp / a.att).toBeGreaterThan(0.3);
  });
  it('a play always ends', () => {
    for (let seed = 1; seed < 50; seed++) {
      const s = play({ seed });
      let n = 0;
      step(s, [{ k: 'snap' }]);
      while (!s.finished && n++ < 3000) { if (s.frozen) acceptHandoff(s); step(s); }
      expect(s.finished).toBe(true);
    }
  });
});
