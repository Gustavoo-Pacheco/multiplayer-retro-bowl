// The huddle on the real room server: secret calls, the seven seconds, and what it refuses.
import { afterEach, describe, expect, it } from 'vitest';
import { T } from '../../src/shared/sim/tuning';
import { TestClient } from './client';
import { clearInbox, expire, pair, toHuddle, waitState } from './helpers';

const open: TestClient[] = [];
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

/** Both players in the first huddle, with nobody calling for them. */
async function inHuddle(cfg = {}) {
  const p = await pair(open, cfg);
  await p.start();
  p.a.autoCall = false;
  p.b.autoCall = false;
  return { p, ...(await toHuddle(p)) };
}

describe('the huddle', () => {
  it('each side sees its own pick and call, never the other side\'s, until the huddle breaks', async () => {
    const { huddle, offView, defView, off, def } = await inHuddle();
    const id = huddle.play!.id;
    expect(offView.huddle!.suggest[0]).toBeGreaterThanOrEqual(0);
    expect(offView.huddle!.suggest[1]).toBe(-1);
    expect(defView.huddle!.suggest[0]).toBe(-1);
    expect(defView.huddle!.suggest[1]).toBeGreaterThanOrEqual(0);
    clearInbox(off, def);
    off.send({ t: 'call', playId: id, side: 'off', id: 13 });
    const seenByDef = await waitState(def, (m) => m.phase === 'huddle' && m.huddle!.calls[0] !== -1);
    expect(seenByDef.huddle!.calls[0]).toBe(-2);
    const seenByOff = await waitState(off, (m) => m.phase === 'huddle' && m.huddle!.calls[0] !== -1);
    expect(seenByOff.huddle!.calls[0]).toBe(13);
    // The defense's call breaks the huddle, and the play goes out with both.
    def.send({ t: 'call', playId: id, side: 'def', id: 8 });
    const start = await def.wait('playStart');
    expect(start.play.playbook).toBe(13);
    expect(start.play.defense).toBe(8);
    expect(start.match.phase).toBe('presnap');
    expect(start.pc).toBeGreaterThan(5000);
  });

  it("time's up: whoever hasn't called gets the coach's pick", async () => {
    const { huddle, defView, off } = await inHuddle();
    const defPick = defView.huddle!.suggest[1];
    off.send({ t: 'call', playId: huddle.play!.id, side: 'off', id: 2 });
    await waitState(off, (m) => m.huddle?.calls[0] === 2);
    expire(off, 'playClock');
    const start = await off.wait('playStart');
    expect(start.play.playbook).toBe(2);
    expect(start.play.defense).toBe(defPick);
  });

  it('with no calls at all, the room breaks the huddle by itself after seven seconds', async () => {
    const { offView, defView, off } = await inHuddle();
    const at = Date.now();
    const start = await off.wait('playStart', () => true, T.timers.huddle + 3000);
    expect(Date.now() - at).toBeGreaterThan(T.timers.huddle - 1500);
    expect(start.play.playbook).toBe(offView.huddle!.suggest[0]);
    expect(start.play.defense).toBe(defView.huddle!.suggest[1]);
  }, 15000);

  it('refuses a call for the other side, the wrong play, a play that does not exist, or a second call', async () => {
    const { huddle, off, def } = await inHuddle();
    const id = huddle.play!.id;
    clearInbox(off, def);
    def.send({ t: 'call', playId: id, side: 'off', id: 1 });
    expect((await def.wait('error')).code).toBe('forbidden');
    off.send({ t: 'call', playId: id, side: 'def', id: 1 });
    expect((await off.wait('error')).code).toBe('forbidden');
    off.send({ t: 'call', playId: id + 1, side: 'off', id: 1 });
    expect((await off.wait('error')).code).toBe('phase');
    off.send({ t: 'call', playId: id, side: 'off', id: 999 });
    expect((await off.wait('error')).code).toBe('forbidden');
    off.send({ t: 'call', playId: id, side: 'off', id: 1 });
    await waitState(off, (m) => m.huddle?.calls[0] === 1);
    off.send({ t: 'call', playId: id, side: 'off', id: 2 });
    expect((await off.wait('error')).code).toBe('forbidden');
  });

  it('a timeout in the huddle starts it over, with both calls cleared', async () => {
    const { huddle, off, def } = await inHuddle({ timeouts: 3 });
    off.send({ t: 'call', playId: huddle.play!.id, side: 'off', id: 4 });
    await waitState(off, (m) => m.huddle?.calls[0] === 4);
    clearInbox(off, def);
    off.send({ t: 'timeout' });
    const again = await waitState(def, (m) => m.phase === 'huddle' && m.timeouts[off.seat as 0 | 1] === 2);
    expect(again.huddle!.calls).toEqual([-1, -1]);
  });
});
