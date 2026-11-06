import { describe, expect, it } from 'vitest';
import { encodeFrame, decodeFrame, frameFromSim, FRAME_BYTES } from '../../src/shared/protocol';
import { acceptHandoff, tackleChance } from '../../src/shared/sim/contact';
import { catchChance, handsMiss, interceptChance, maxAimErrorDeg, resolvePass, updateFlight } from '../../src/shared/sim/pass';
import { DT, step } from '../../src/shared/sim/step';
import { A, type SimInput, type SimState } from '../../src/shared/sim/state';
import { T } from '../../src/shared/sim/tuning';
import { play } from './helpers';

function run(s: SimState, script: Record<number, SimInput[]> = {}, maxTicks = 1200): SimState {
  for (let i = 0; i < maxTicks && !s.finished; i++) { if (s.frozen) acceptHandoff(s); step(s, script[s.tick] ?? []); }
  return s;
}

describe('determinism', () => {
  it('same seed and inputs give the same result', () => {
    const script: Record<number, SimInput[]> = { 1: [{ k: 'snap' }], 40: [{ k: 'aimStart' }], 42: [{ k: 'aim', dx: 14, dy: 3 }], 70: [{ k: 'throw' }] };
    const a = run(play(), script);
    const b = run(play(), script);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.finished).toBe(true);
  });
  it('a different seed gives a different result', () => {
    const script: Record<number, SimInput[]> = { 1: [{ k: 'snap' }], 40: [{ k: 'aimStart' }], 42: [{ k: 'aim', dx: 14, dy: 3 }], 70: [{ k: 'throw' }] };
    const a = run(play({ seed: 1 }), script);
    const b = run(play({ seed: 2 }), script);
    expect(JSON.stringify(a.players)).not.toBe(JSON.stringify(b.players));
  });
  it('the state survives a JSON round trip mid-play and replays identically', () => {
    const s = play();
    step(s, [{ k: 'snap' }]);
    for (let i = 0; i < 30; i++) step(s);
    const copy = JSON.parse(JSON.stringify(s)) as SimState;
    for (let i = 0; i < 200; i++) { step(s); step(copy); }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
  });
});

describe('formulas', () => {
  it('interception odds match the plan', () => {
    expect(interceptChance(5, 0.5)).toBeCloseTo(0.1 + 0.15 - 0.05);
    expect(interceptChance(1, 3)).toBe(T.chance.min);
    // A fully bad pass adds pickBadPass.
    expect(interceptChance(5, 1.5, 1)).toBeCloseTo(0.1 + 0.15 - 0.15 + T.pass.pickBadPass);
  });
  it('catch odds match the plan', () => {
    expect(catchChance(5, 0, false, 'clear', false)).toBeCloseTo(T.pass.catchBase + 5 * T.pass.catchPerAttr);
    // Every penalty at once, on a receiver good enough to stay above the floor.
    expect(catchChance(8, 0.5, true, 'rain', true)).toBeCloseTo(T.pass.catchBase + 8 * T.pass.catchPerAttr - 0.5 * T.pass.catchPerMiss - 0.15 - 0.1 - 0.15);
    expect(catchChance(10, 0, false, 'clear', false)).toBeCloseTo(T.chance.max + 0.0, 1);
  });
  it('the hands box runs from the waist to above the head, as wide as the receiver', () => {
    const rc = { x: 50, y: 8 };
    const { handsLo, handsHi, handsHalfW } = T.pass;
    // A ball drawn at his chest or at the corner of the box is in his hands.
    expect(handsMiss(rc, 50, 8, (handsLo + handsHi) / 2)).toBe(0);
    expect(handsMiss(rc, 50 + handsHalfW, 8, handsHi)).toBe(0);
    // A ball at his feet is below the box by the height of his waist.
    expect(handsMiss(rc, 50, 8, 0)).toBeCloseTo(handsLo);
    // A ball whose spot is a yard behind him is drawn a yard higher on screen.
    expect(handsMiss(rc, 50, 7, handsHi)).toBeCloseTo(1);
  });
  it('tackle odds match the plan', () => {
    expect(tackleChance(5, 5, 'side', false, false)).toBeCloseTo(0.5);
    expect(tackleChance(8, 5, 'behind', false, false)).toBeCloseTo(T.contact.tackleBase + T.contact.tacklePerAttr * 3 + T.contact.behind);
    expect(tackleChance(5, 5, 'front', true, false)).toBeCloseTo(0.05);
    expect(tackleChance(5, 5, 'front', false, true)).toBeCloseTo(0.15);
    expect(tackleChance(5, 5, 'behind', false, true)).toBeCloseTo(0.9);
  });
  it('throw error follows accuracy', () => {
    expect(maxAimErrorDeg(10, 0)).toBe(0);
    expect(maxAimErrorDeg(5, 0)).toBeCloseTo(5 * T.pass.errorPerAccuracyDeg);
  });
  it('sampled catch rate matches the formula', () => {
    let hits = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const s = play({ seed: i + 1 });
      s.phase = 'flight';
      const rc = s.players[2];
      for (const p of s.players) if (p.seat !== s.desc.offense) { p.x = 5; p.y = 1; }
      // Half a yard beyond the side of his hands box, at waist height.
      s.ball.x = rc.x + T.pass.handsHalfW + 0.5; s.ball.y = rc.y; s.ball.z = T.pass.handsLo;
      s.pass = { bullet: false, target: 2, piFlag: false, piSpotX: 0, piChecked: true, distance: 10, thrownFromX: 30, reachI: -1, reachD: 1e9 };
      resolvePass(s);
      if (s.ball.holder === 2) hits += 1;
    }
    const expected = catchChance(play().players[2].cat, 0.5, false, 'clear', false);
    expect(Math.abs(hits / n - expected)).toBeLessThan(0.035);
  });
});

/** A ball in the air along receiver 2's line, landing 2 yards past him, with everyone else out of the way. */
function inFlight(seed: number): SimState {
  const s = play({ seed });
  s.phase = 'flight';
  const rc = s.players[2];
  for (const p of s.players) {
    if (p.seat !== s.desc.offense) { p.x = 5; p.y = 1; }
    else if (p.i !== 2 && p.role !== 'OL' && p.role !== 'QB') { p.x = 5; p.y = 16; }
  }
  const b = s.ball;
  b.holder = -1;
  b.sx = rc.x - 18; b.sy = rc.y; b.ex = rc.x + 2; b.ey = rc.y; b.t = 0; b.dur = 20 / T.pass.speed;
  b.startZ = T.pass.throwHeight; b.endZ = T.pass.catchHeight; b.peak = T.pass.minPeak;
  s.pass = { bullet: false, target: 2, piFlag: false, piSpotX: 0, piChecked: true, distance: 20, thrownFromX: b.sx, reachI: -1, reachD: 1e9 };
  return s;
}

describe('catch check', () => {
  it('a ball that reaches a receiver before its spot is tried for there, at full odds', () => {
    let hits = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const s = inFlight(i + 1);
      for (let k = 0; k < 200 && s.phase === 'flight'; k++) updateFlight(s, DT);
      expect(s.ball.t).toBeLessThan(s.ball.dur);
      if (s.ball.holder === 2) hits += 1;
      else expect(s.players[2].anim).toBe(A.drop);
    }
    const expected = catchChance(play().players[2].cat, 0, false, 'clear', false);
    expect(Math.abs(hits / n - expected)).toBeLessThan(0.035);
  });
  it('a receiver nearer the ball than the defender shields it from a pick', () => {
    const picks = (receiverGap: number) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const s = inFlight(i + 1);
        const b = s.ball;
        const d = s.players.filter((p) => p.seat !== s.desc.offense).sort((p, q) => q.cat - p.cat)[0];
        d.x = b.ex; d.y = b.ey + 0.6;
        s.players[2].x = b.ex; s.players[2].y = b.ey - receiverGap;
        b.t = b.dur - DT / 2;
        updateFlight(s, DT);
        if (s.ball.holder === d.i) n += 1;
      }
      return n;
    };
    expect(picks(0.3)).toBe(0);
    expect(picks(3)).toBeGreaterThan(0);
  });
});

describe('slingshot', () => {
  it('a release in the dead zone cancels and keeps the ball', () => {
    const s = run(play(), { 1: [{ k: 'snap' }], 20: [{ k: 'aimStart' }, { k: 'aim', dx: 0.5, dy: 0 }], 40: [{ k: 'throw' }] }, 45);
    expect(s.phase).toBe('pocket');
    expect(s.ball.holder).toBe(0);
  });
  it('a hold under 120 ms cancels', () => {
    const s = run(play(), { 1: [{ k: 'snap' }], 20: [{ k: 'aimStart' }, { k: 'aim', dx: 15, dy: 0 }], 23: [{ k: 'throw' }] }, 30);
    expect(s.phase).toBe('pocket');
  });
  it('a long enough hold throws to the aimed point within arm range', () => {
    const s = run(play(), { 1: [{ k: 'snap' }], 20: [{ k: 'aimStart' }, { k: 'aim', dx: 200, dy: 0 }], 40: [{ k: 'throw' }] }, 42);
    expect(s.phase).toBe('flight');
    expect(Math.hypot(s.ball.ex - s.ball.sx, s.ball.ey - s.ball.sy)).toBeCloseTo(s.armRange, 4);
  });
  it('a bullet pass flies 1.6 times as fast', () => {
    const a = run(play(), { 1: [{ k: 'snap' }], 20: [{ k: 'aimStart' }, { k: 'aim', dx: 20, dy: 0 }], 40: [{ k: 'throw' }] }, 42);
    const b = run(play(), { 1: [{ k: 'snap' }], 20: [{ k: 'aimStart' }, { k: 'aim', dx: 20, dy: 0 }, { k: 'bullet' }], 40: [{ k: 'throw' }] }, 42);
    expect(a.ball.dur / b.ball.dur).toBeCloseTo(T.pass.bulletMult, 3);
  });
  it('without a throw, the rush eventually reaches the QB', () => {
    let sacks = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = run(play({ seed }), { 1: [{ k: 'snap' }] }, 900);
      if (s.result?.sack) sacks += 1;
    }
    expect(sacks).toBeGreaterThan(14);
  });
});

describe('frames', () => {
  it('stay under the 256-byte limit and round trip', () => {
    const s = play();
    step(s, [{ k: 'snap' }]);
    for (let i = 0; i < 60; i++) step(s);
    const f = frameFromSim(s);
    const buf = encodeFrame(f);
    expect(buf.byteLength).toBe(FRAME_BYTES);
    expect(buf.byteLength).toBeLessThanOrEqual(T.net.maxFrameBytes);
    const d = decodeFrame(buf);
    expect(d.playId).toBe(f.playId);
    expect(d.tick).toBe(f.tick);
    expect(d.phase).toBe(f.phase);
    expect(d.bx).toBeCloseTo(f.bx, 1);
    for (let i = 0; i < 16; i++) {
      expect(d.px[i]).toBeCloseTo(f.px[i], 1);
      expect(d.py[i]).toBeCloseTo(f.py[i], 1);
      expect(d.anim[i]).toBe(f.anim[i]);
      expect(d.face[i]).toBe(f.face[i]);
    }
  });
});
