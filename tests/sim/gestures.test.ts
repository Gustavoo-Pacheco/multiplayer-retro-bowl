import { describe, expect, it } from 'vitest';
import { GestureRecognizer, type GestureContext } from '../../src/client/input/gestures';

const ctx = (over: Partial<GestureContext> = {}): GestureContext => ({ phase: 'pocket', active: true, qb: { x: 100, y: 200 }, rb: { x: 80, y: 220 }, handoffOpen: true, ...over });

function make(over: Partial<GestureContext> = {}): GestureRecognizer {
  const g = new GestureRecognizer();
  g.ctx = ctx(over);
  return g;
}

describe('gestures', () => {
  it('a tap on the field before the snap snaps the ball', () => {
    const g = make({ phase: 'pre' });
    g.down(1, 300, 200, 0);
    expect(g.drain()).toEqual([{ k: 'snap' }]);
  });
  it('a watcher produces no inputs', () => {
    const g = make({ phase: 'pre', active: false });
    g.down(1, 300, 200, 0);
    expect(g.drain()).toEqual([]);
  });
  it('a quick still press on the RB is a handoff', () => {
    const g = make();
    g.down(1, 80, 208, 0);
    expect(g.drain()).toEqual([]);
    g.up(1, 80, 208, 100);
    expect(g.drain()).toEqual([{ k: 'handoff' }]);
  });
  it('a quick still press on the QB is a QB run', () => {
    const g = make();
    g.down(1, 100, 188, 0);
    g.up(1, 100, 188, 100);
    expect(g.drain()).toEqual([{ k: 'qbRun' }]);
  });
  it('moving 8 px on the RB starts aiming instead', () => {
    const g = make();
    g.down(1, 80, 208, 0);
    g.move(1, 70, 208, 50);
    const out = g.drain();
    expect(out[0]).toEqual({ k: 'aimStart' });
    expect(out.at(-1)?.k).toBe('aim');
  });
  it('holding the RB past 200 ms starts aiming instead', () => {
    const g = make();
    g.down(1, 80, 208, 0);
    g.tick(250);
    expect(g.drain()[0]).toEqual({ k: 'aimStart' });
  });
  it('dragging away from the target points the aim the other way', () => {
    const g = make();
    g.down(1, 300, 100, 0);
    g.drain();
    g.move(1, 200, 120, 30);
    const aim = g.drain().at(-1) as { k: 'aim'; dx: number; dy: number };
    expect(aim.dx).toBeGreaterThan(0);
    expect(aim.dy).toBeLessThan(0);
    g.up(1, 200, 120, 400);
    expect(g.drain()).toEqual([{ k: 'throw' }]);
  });
  it('a second finger while aiming is a bullet pass', () => {
    const g = make();
    g.down(1, 300, 100, 0);
    g.drain();
    g.down(2, 400, 100, 10);
    expect(g.drain()).toEqual([{ k: 'bullet' }]);
  });
  it('with the runner, 24 px within 250 ms is a swipe', () => {
    const g = make({ phase: 'run' });
    g.down(1, 300, 200, 0);
    g.drain();
    g.move(1, 300, 170, 100);
    const out = g.drain();
    expect(out).toEqual([{ k: 'swipe', dx: 0, dy: -30 }]);
  });
  it('a slow drag is not a swipe', () => {
    const g = make({ phase: 'run' });
    g.down(1, 300, 200, 0);
    g.drain();
    g.move(1, 300, 170, 500);
    expect(g.drain().filter((i) => i.k === 'swipe')).toEqual([]);
  });
  it('holding still for 180 ms starts trucking, and release stops it', () => {
    const g = make({ phase: 'run' });
    g.down(1, 300, 200, 0);
    g.drain();
    g.tick(100);
    expect(g.drain()).toEqual([]);
    g.tick(190);
    expect(g.drain()).toEqual([{ k: 'truck', on: true }]);
    g.up(1, 300, 200, 400);
    expect(g.drain()).toEqual([{ k: 'truck', on: false }]);
  });
  it('kick phases send a tap', () => {
    const g = make({ phase: 'kickPower' });
    g.down(1, 300, 200, 0);
    expect(g.drain()).toEqual([{ k: 'tap' }]);
  });
});
