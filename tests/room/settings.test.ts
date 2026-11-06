// The settings the room server enforces itself.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_OPTIONS } from '../../src/shared/data/config';
import { TestClient } from './client';
import { clearInbox, pair, toHuddle, toScrimmage, waitState } from './helpers';

const open: TestClient[] = [];
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

const start = async (cfg: Record<string, unknown>) => {
  const p = await pair(open, cfg);
  await p.start();
  return { p, ...(await toScrimmage(p)) };
};

describe('settings the server enforces', () => {
  for (const playClock of CONFIG_OPTIONS.playClock) {
    it(`a ${playClock} s play clock is what the room counts`, async () => {
      const { off } = await start({ playClock });
      clearInbox(off);
      off.send({ t: 'timeout' });
      const m = await off.wait('playStart');
      expect(m.pc).toBeLessThanOrEqual(playClock * 1000);
      expect(m.pc).toBeGreaterThan((playClock - 2) * 1000);
    });
  }

  it('pauses per player: the allowance runs out, and each player has their own', async () => {
    const { off, def } = await start({ pauses: 2 });
    for (let i = 0; i < 2; i++) {
      off.send({ t: 'pause' });
      await def.wait('paused', (m) => m.by === off.seat);
      off.send({ t: 'pause' });
      await def.wait('paused', (m) => m.by === null);
    }
    clearInbox(off, def);
    off.send({ t: 'pause' });
    await new Promise((r) => setTimeout(r, 300));
    expect(def.inbox.some((m) => m.t === 'paused')).toBe(false);
    def.send({ t: 'pause' });
    await off.wait('paused', (m) => m.by === def.seat);
  });

  it('game clock: Runs counts down between plays, holds for a pause, stops for a timeout, and ends the quarter at 0:00', async () => {
    const { off, def, match: m0 } = await start({ clock: 'runs' });
    expect(m0.runoffPending).toBe(true);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // A pause holds it.
    off.send({ t: 'pause' });
    const atPause = await waitState(def, (m) => m.phase === 'presnap');
    await sleep(1000);
    clearInbox(off, def);
    off.send({ t: 'pause' });
    const resumed = await waitState(def, (m) => m.phase === 'presnap');
    expect(atPause.clock - resumed.clock).toBeLessThan(0.3);

    // Then it runs in real time, until a timeout stops it.
    await sleep(1200);
    clearInbox(off, def);
    off.send({ t: 'timeout' });
    const timedOut = await waitState(def, (m) => m.phase === 'huddle' && m.timeouts[off.seat!] < resumed.timeouts[off.seat!]);
    expect(resumed.clock - timedOut.clock).toBeGreaterThan(1);
    expect(resumed.clock - timedOut.clock).toBeLessThan(2.5);
    expect(timedOut.runoffPending).toBe(false);
    await sleep(600);
    const huddleBroke = await waitState(def, (m) => m.phase === 'presnap');
    expect(huddleBroke.clock).toBe(timedOut.clock);

    // Nobody snaps: at 0:00 the room ends the quarter by itself.
    off.send({ t: 'dev', op: 'patch', patch: { clock: 1, runoffPending: true } });
    const ended = await waitState(def, (m) => m.period === 2, 5000);
    expect([ended.phase, ended.banner?.kind]).toEqual(['banner', 'quarter']);
  });

  it('no pauses at all when the setting is 0', async () => {
    const { off, def } = await start({ pauses: 0 });
    clearInbox(def);
    off.send({ t: 'pause' });
    await new Promise((r) => setTimeout(r, 300));
    expect(def.inbox.some((m) => m.t === 'paused')).toBe(false);
  });

  it('defense calls: Computer has the defense called before the defense player could', async () => {
    const p = await pair(open, { defense: 'computer' });
    await p.start();
    p.a.autoCall = false;
    p.b.autoCall = false;
    const { huddle, offView, off, def } = await toHuddle(p);
    expect(offView.huddle?.computer).toBe(true);
    // Already made, and hidden from the offense.
    expect(offView.huddle?.calls[1]).toBe(-2);
    def.send({ t: 'call', playId: huddle.play!.id, side: 'def', id: 0 });
    expect((await def.wait('error')).code).toBe('forbidden');
    off.send({ t: 'call', playId: huddle.play!.id, side: 'off', id: 6 });
    const m = await waitState(def, (x) => x.phase === 'presnap' && x.play?.type === 'scrimmage');
    expect(m.play?.playbook).toBe(6);
    expect(m.play?.defense).toBeGreaterThanOrEqual(0);
  });

  for (const reconnect of CONFIG_OPTIONS.reconnect) {
    it(`the ${reconnect} minute reconnect window is the time on offer`, async () => {
      const { off, def } = await start({ reconnect });
      def.close();
      const w = await off.wait('waiting', (m) => m.on && m.missing[def.seat as 0 | 1]);
      const left = w.left[def.seat as 0 | 1]!;
      expect(left).toBeLessThanOrEqual(reconnect * 60000);
      expect(left).toBeGreaterThan((reconnect * 60000) - 3000);
    });
  }
});
