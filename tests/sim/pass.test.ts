import { describe, expect, it } from 'vitest';
import { encodeFrame, decodeFrame, frameFromSim, FRAME_BYTES } from '../../src/shared/protocol';
import { acceptHandoff, tackleChance } from '../../src/shared/sim/contact';
import { catchChance, interceptChance, maxAimErrorDeg, resolvePass } from '../../src/shared/sim/pass';
import { step } from '../../src/shared/sim/step';
import type { SimInput, SimState } from '../../src/shared/sim/state';
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
  });
  it('catch odds match the plan', () => {
    expect(catchChance(5, 0, false, 'clear', false)).toBeCloseTo(T.pass.catchBase + 5 * T.pass.catchPerAttr);
    expect(catchChance(5, 1, true, 'rain', true)).toBeCloseTo(T.pass.catchBase + 5 * T.pass.catchPerAttr - 0.25 - 0.15 - 0.1 - 0.15);
    expect(catchChance(10, 0, false, 'clear', false)).toBeCloseTo(T.chance.max + 0.0, 1);
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
      s.ball.x = rc.x + 1; s.ball.y = rc.y;
      s.pass = { bullet: false, target: 2, piFlag: false, piSpotX: 0, piChecked: true, distance: 10, thrownFromX: 30 };
      resolvePass(s);
      if (s.ball.holder === 2) hits += 1;
    }
    const expected = catchChance(play().players[2].cat, 1, false, 'clear', false);
    expect(Math.abs(hits / n - expected)).toBeLessThan(0.035);
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
