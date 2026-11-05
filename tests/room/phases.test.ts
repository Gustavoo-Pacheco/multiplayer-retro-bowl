// Each player drops in each phase, and both drop at once.
import { afterEach, describe, expect, it } from 'vitest';
import type { Seat } from '../../src/shared/sim/state';
import { joined, TestClient } from './client';
import { clearInbox, expire, pair, toScrimmage, waitState } from './helpers';

const open: TestClient[] = [];
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

type Setup = { name: string; patch: Record<string, unknown> | null; bannerFirst?: boolean };
const PHASES: Setup[] = [
  { name: 'presnap', patch: null },
  { name: 'choice4th', patch: { phase: 'choice4th', down: 4, toGo: 4, play: null, chosen4th: false } },
  { name: 'conversion', patch: { phase: 'conversion', play: null } },
  { name: 'kickChoice', patch: { phase: 'kickChoice', play: null } },
  { name: 'banner', patch: { phase: 'banner', banner: { kind: 'quarter', text: 'END OF Q1' }, after: { k: 'scrimmage' }, down: 1, toGo: 10 }, bannerFirst: true },
];

async function arrive(open: TestClient[], cfg = {}) {
  const p = await pair(open, cfg);
  await p.start();
  const s = await toScrimmage(p);
  return { p, ...s };
}

describe('every player, every phase', () => {
  for (const ph of PHASES) {
    for (const who of ['controller', 'watcher'] as const) {
      it(`${who} drops during ${ph.name}: the match waits, and resumes when they return`, async () => {
        const { p, off, def } = await arrive(open);
        if (ph.patch) { p.a.send({ t: 'dev', op: 'patch', patch: ph.patch as never }); await waitState(p.a, (m) => m.phase === ph.name); await waitState(p.b, (m) => m.phase === ph.name); }
        const gone = who === 'controller' ? off : def;
        const stays = who === 'controller' ? def : off;
        const token = gone.token;
        const seat = gone.seat as Seat;
        clearInbox(stays);
        gone.close();
        await stays.wait('room', (m) => m.room.seats[seat]?.online === false);
        // A banner plays out, and the match then holds at the next dead ball.
        if (ph.bannerFirst) expire(stays, 'banner');
        const w = await stays.wait('waiting', (m) => m.on && m.missing[seat]);
        expect(w.left[seat]).toBeGreaterThan(0);
        const back = await joined(p.code, 'Back', { token });
        open.push(back);
        expect(back.seat).toBe(seat);
        await stays.wait('waiting', (m) => !m.on);
        // The returning player has the current state. It arrives just before their own waiting message.
        await back.wait('waiting');
        const st = back.inbox.filter((m) => m.t === 'matchState' || m.t === 'playStart');
        expect(st.length).toBeGreaterThan(0);
      });
    }
    it(`both drop during ${ph.name}: state stays saved, and both resume`, async () => {
      const { p, off, def } = await arrive(open);
      if (ph.patch) { p.a.send({ t: 'dev', op: 'patch', patch: ph.patch as never }); await waitState(p.a, (m) => m.phase === ph.name); }
      const [tOff, tDef] = [off.token, def.token];
      const [sOff, sDef] = [off.seat, def.seat];
      off.close(); def.close();
      await new Promise((r) => setTimeout(r, 120));
      const a = await joined(p.code, 'A', { token: tOff });
      const b = await joined(p.code, 'B', { token: tDef });
      open.push(a, b);
      expect(a.seat).toBe(sOff);
      expect(b.seat).toBe(sDef);
      if (ph.bannerFirst) expire(a, 'banner');
      await a.wait('waiting', (m) => !m.on);
    });
  }

  it('a player drops at the coin toss: it still resolves, and the match holds for them', async () => {
    const p = await pair(open);
    await p.start();
    const token = p.b.token;
    p.b.close();
    await p.a.wait('room', (m) => m.room.seats[1]?.online === false);
    clearInbox(p.a);
    expire(p.a, 'banner');
    await p.a.wait('waiting', (m) => m.on);
    const back = await joined(p.code, 'Bob', { token });
    open.push(back);
    await p.a.wait('waiting', (m) => !m.on);
  });

  it('a player drops on the final screen: nothing waits, and the rematch still works', async () => {
    const { p, off, def } = await arrive(open);
    off.send({ t: 'concede' });
    await waitState(def, (m) => m.phase === 'final');
    const token = off.token;
    off.close();
    await def.wait('room', (m) => m.room.seats[off.seat as Seat]?.online === false);
    expect(def.inbox.some((m) => m.t === 'waiting' && m.on)).toBe(false);
    def.send({ t: 'rematch' });
    await def.wait('room', (m) => m.room.screen === 'lobby');
    const back = await joined(p.code, 'Off', { token });
    open.push(back);
    const r = await back.wait('room');
    expect(r.room.screen).toBe('lobby');
  });

  it('the watcher drops mid-play: frames keep flowing and the play carries on, then the match holds', async () => {
    const { match, off, def } = await arrive(open);
    off.send({ t: 'snap', playId: match.play!.id });
    await def.wait('snap');
    clearInbox(off);
    def.close();
    await off.wait('waiting');
    expect(off.inbox.some((m) => m.t === 'waiting' && m.on)).toBe(false);
  });
});
