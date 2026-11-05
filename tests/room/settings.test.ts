// The settings the room server enforces itself.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_OPTIONS } from '../../src/shared/data/config';
import { TestClient } from './client';
import { clearInbox, pair, toScrimmage, waitState } from './helpers';

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

  it('no pauses at all when the setting is 0', async () => {
    const { off, def } = await start({ pauses: 0 });
    clearInbox(def);
    off.send({ t: 'pause' });
    await new Promise((r) => setTimeout(r, 300));
    expect(def.inbox.some((m) => m.t === 'paused')).toBe(false);
  });

  it('audibles: the pool is spent, and 0 means none', async () => {
    const one = await start({ audibles: 1 });
    const id = one.match.play!.id;
    one.off.send({ t: 'audible', playId: id });
    await waitState(one.off, (m) => m.audibles[one.off.seat as 0 | 1] === 0);
    clearInbox(one.off);
    one.off.send({ t: 'audible', playId: id + 1 });
    await one.off.wait('error');
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
