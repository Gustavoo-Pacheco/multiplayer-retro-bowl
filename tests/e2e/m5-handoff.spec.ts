// Forced turnovers, returns and offline watchers, with real added delay.
import { expect, test } from '@playwright/test';
import { closePlayers, makeRoom, pickAndReady, player, setOption, snap, type Player } from './helpers';

const DELAY = 300;

async function ready(baseURL: string | undefined, qs = 'dev=1&bot=1&speed=2') {
  const a = await player(baseURL);
  const b = await player(baseURL);
  await makeRoom(a, b, qs);
  await setOption(a.page, 'replays', 'off');
  await pickAndReady(a, b, 'SEA', 'LAR');
  return { a, b };
}

/** Which page runs the current scrimmage play from before the snap. */
async function offenseAtPresnap(a: Player, b: Player, timeout = 120000): Promise<{ off: Player; def: Player }> {
  const until = Date.now() + timeout;
  for (;;) {
    for (const [off, def] of [[a, b], [b, a]] as const) {
      const on = await off.page.evaluate(() => {
        const s = (window as any).__borg;
        return !!s.sim && s.sim.desc.type === 'scrimmage' && s.sim.phase === 'pre' && s.match?.phase === 'presnap' && s.sim.desc.down < 4;
      });
      if (on) return { off, def };
    }
    if (Date.now() > until) throw new Error('no scrimmage play offered');
    await a.page.waitForTimeout(40);
  }
}

/** Forces an interception on the next pass from this page. */
/** A longer hold risks a sack before the throw, which means no pick: 2.5 s missed about 1 play in 4, and 0.8 s about 1 in 200. */
async function forcePick(off: Player, hold = 0.6): Promise<void> {
  await off.page.evaluate((h) => { const s = (window as any).__borg; s.bot.plan = 'pass'; s.bot.holdUntil = h; s.sim.force = 'int'; s.bot.playId = s.sim.desc.id; }, hold);
}
/** Waits until the play is live: a watcher who leaves before the snap just makes the match wait. */
async function pocket(off: Player): Promise<void> {
  await off.page.waitForFunction(() => (window as any).__borg.sim?.phase === 'pocket', undefined, { timeout: 15000 });
}
/** Forces a fumble lost at the next tackle, on a run. */
async function forceFumble(off: Player): Promise<void> {
  await off.page.evaluate(() => { const s = (window as any).__borg; s.bot.plan = 'run'; s.sim.force = 'fumble'; s.bot.playId = s.sim.desc.id; });
}

async function handoffCount(p: Player): Promise<number> { return (await snap(p.page)).handoffs; }

test('a forced interception at 300 ms hands control over and the old controller becomes the watcher', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    const { off, def } = await offenseAtPresnap(a, b);
    a.proxy.setDelay(DELAY, 30);
    b.proxy.setDelay(DELAY, 30);
    const before = await handoffCount(def);
    const offSeat = (await snap(off.page)).seat;
    await forcePick(off);
    // The new controller takes over.
    await expect.poll(() => handoffCount(def), { timeout: 20000 }).toBeGreaterThan(before);
    expect((await def.page.evaluate(() => (window as any).__borg.log.at(-1)))).toBe('handoff:int');
    await expect.poll(async () => (await snap(off.page)).yields, { timeout: 20000 }).toBeGreaterThan(0);
    expect((await snap(def.page)).ctrl).toBe(true);
    expect((await snap(off.page)).ctrl).toBe(false);
    // The runner keeps moving with no input, and the old controller sees frames.
    const framesBefore = (await snap(off.page)).framesRecv;
    await expect.poll(async () => (await snap(off.page)).framesRecv, { timeout: 15000 }).toBeGreaterThan(framesBefore);
    // The play ends with the ball on the other side.
    const playId = await def.page.evaluate(() => (window as any).__borg.sim?.desc.id ?? -1);
    await def.page.waitForFunction((id) => (window as any).__borg.match.playId > id, playId, { timeout: 30000 });
    await off.page.waitForFunction((id) => (window as any).__borg.match.playId > id, playId, { timeout: 15000 });
    const st = await off.page.evaluate(() => (window as any).__borg.match);
    const last = st.last;
    expect(last.turnover).toBe(true);
    expect(last.offense).toBe(offSeat);
    expect(last.possessor).toBe(1 - offSeat);
    expect(a.errors.concat(b.errors)).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('a forced lost fumble at 300 ms hands off correctly', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    a.proxy.setDelay(DELAY, 30);
    b.proxy.setDelay(DELAY, 30);
    // A fumble needs a tackle, so a breakaway can miss it. Try a few plays.
    let done = false;
    for (let tries = 0; tries < 12 && !done; tries++) {
      const { off, def } = await offenseAtPresnap(a, b);
      const before = await handoffCount(def);
      const yieldsBefore = (await snap(off.page)).yields;
      const id = await off.page.evaluate(() => (window as any).__borg.sim.desc.id);
      await forceFumble(off);
      for (let i = 0; i < 400; i++) {
        if ((await handoffCount(def)) > before) { done = true; break; }
        if (await off.page.evaluate((x) => (window as any).__borg.match.playId !== x, id)) break;
        await a.page.waitForTimeout(50);
      }
      if (done) {
        expect(await def.page.evaluate(() => (window as any).__borg.log.at(-1))).toBe('handoff:fumble');
        await expect.poll(async () => (await snap(off.page)).yields, { timeout: 20000 }).toBeGreaterThan(yieldsBefore);
      }
    }
    expect(done).toBe(true);
    expect(a.errors.concat(b.errors)).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('an interception then a fumble back: two handoffs on one play', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    a.proxy.setDelay(DELAY);
    b.proxy.setDelay(DELAY);
    let done = false;
    for (let tries = 0; tries < 12 && !done; tries++) {
      const { off, def } = await offenseAtPresnap(a, b);
      const offBefore = await handoffCount(off);
      const defBefore = await handoffCount(def);
      const id = await off.page.evaluate(() => (window as any).__borg.sim.desc.id);
      await forcePick(off);
      await expect.poll(() => handoffCount(def), { timeout: 25000 }).toBeGreaterThan(defBefore);
      // The new runner loses it straight away.
      await def.page.evaluate(() => { const s = (window as any).__borg; if (s.sim) s.sim.force = 'fumble'; });
      for (let i = 0; i < 300; i++) {
        if ((await handoffCount(off)) > offBefore) { done = true; break; }
        if (await def.page.evaluate((x) => (window as any).__borg.match.playId !== x, id)) break;
        await a.page.waitForTimeout(50);
      }
      if (done) {
        expect(await off.page.evaluate(() => (window as any).__borg.log.at(-1))).toBe('handoff:fumble');
        expect((await snap(off.page)).ctrl).toBe(true);
        await expect.poll(async () => (await snap(def.page)).ctrl, { timeout: 15000 }).toBe(false);
        // The play then ends normally, and both agree.
        await off.page.waitForFunction((x) => (window as any).__borg.match.playId !== x, id, { timeout: 30000 });
        await expect.poll(async () => (await snap(def.page)).score, { timeout: 8000 }).toEqual((await snap(off.page)).score);
      }
    }
    expect(done).toBe(true);
    expect(a.errors.concat(b.errors)).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('turnover with the watcher offline: the auto-runner finishes, and the match waits for them', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    const { off, def } = await offenseAtPresnap(a, b);
    await forcePick(off, 0.8);
    await pocket(off);
    def.proxy.block(true);
    const before = (await snap(off.page)).continues;
    await expect.poll(async () => (await snap(off.page)).continues, { timeout: 25000 }).toBeGreaterThan(before);
    expect((await snap(off.page)).ctrl).toBe(true);
    expect(await off.page.evaluate(() => (window as any).__borg.sim.autoRun)).toBe(true);
    // The play finishes by itself, and the match holds at the next dead ball.
    await off.page.waitForFunction(() => (window as any).__borg.waiting === true, undefined, { timeout: 30000 });
    const m = await off.page.evaluate(() => (window as any).__borg.match);
    expect(m.last.turnover).toBe(true);
    // They come back and get their possession.
    def.proxy.block(false);
    await off.page.waitForFunction(() => (window as any).__borg.waiting === false, undefined, { timeout: 20000 });
    await def.page.waitForFunction(() => (window as any).__room.net.status === 'open', undefined, { timeout: 20000 });
    expect(a.errors.concat(b.errors)).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('turnover with the watcher\'s page hidden: the auto-runner finishes', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    const { off, def } = await offenseAtPresnap(a, b);
    await forcePick(off, 0.8);
    await pocket(off);
    await def.page.evaluate(() => (window as any).__room.net.send({ t: 'visibility', visible: false }));
    const before = (await snap(off.page)).continues;
    await expect.poll(async () => (await snap(off.page)).continues, { timeout: 25000 }).toBeGreaterThan(before);
    await off.page.waitForFunction(() => (window as any).__borg.waiting === true, undefined, { timeout: 30000 });
    await def.page.evaluate(() => (window as any).__room.net.send({ t: 'visibility', visible: true }));
    await off.page.waitForFunction(() => (window as any).__borg.waiting === false, undefined, { timeout: 10000 });
  } finally { await closePlayers(a, b); }
});

test('kick returns hand control to the receiver with no freeze, at 300 ms', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    a.proxy.setDelay(DELAY);
    b.proxy.setDelay(DELAY);
    // The opening kickoff.
    const kicker = await a.page.evaluate(() => (window as any).__borg.match.openingKicker);
    const [k, r] = kicker === (await snap(a.page)).seat ? [a, b] : [b, a];
    await r.page.waitForFunction(() => (window as any).__borg.log.includes('handoff:kick'), undefined, { timeout: 30000 });
    expect(await r.page.evaluate(() => (window as any).__borg.sim?.frozen ?? false)).toBe(false);
    await k.page.waitForFunction(() => (window as any).__borg.log.includes('yield:kick'), undefined, { timeout: 15000 });
    // The kicker's picture never moved backward during the switch.
    const ticks = await k.page.evaluate(async () => {
      const seen: number[] = [];
      for (let i = 0; i < 30; i++) { seen.push((window as any).__borg.frame.tick); await new Promise((x) => setTimeout(x, 30)); }
      return seen;
    });
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1] - 2);
    expect(a.errors.concat(b.errors)).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('a dropped controller is voided before a handoff, and the turnover stands after one', async ({ baseURL }) => {
  const { a, b } = await ready(baseURL);
  try {
    // Before a handoff: the down replays after the watchdog.
    let { off, def } = await offenseAtPresnap(a, b);
    const before = await off.page.evaluate(() => { const m = (window as any).__borg.match; return { down: m.down, ballX: m.ballX, clock: m.clock, possession: m.possession, score: m.score }; });
    await off.page.evaluate(() => { const s = (window as any).__borg; s.bot.plan = 'pass'; s.bot.holdUntil = 3; s.bot.playId = s.sim.desc.id; });
    await off.page.waitForFunction(() => (window as any).__borg.sim?.phase === 'pocket', undefined, { timeout: 10000 });
    off.proxy.block(true);
    await def.page.waitForFunction((d) => { const m = (window as any).__borg.match; return m.phase === 'presnap' && m.ballX === d.ballX && m.down === d.down; }, before, { timeout: 15000 });
    const after = await def.page.evaluate(() => (window as any).__borg.match);
    expect(after.possession).toBe(before.possession);
    expect(after.clock).toBeGreaterThanOrEqual(before.clock - 0.01 - 20);
    expect(after.score).toEqual(before.score);
    off.proxy.block(false);
    await def.page.waitForFunction(() => (window as any).__borg.waiting === false, undefined, { timeout: 20000 });

    // After a handoff: the new controller vanishes, and the ball stays with them at the handoff spot.
    ({ off, def } = await offenseAtPresnap(a, b));
    const offSeat = (await snap(off.page)).seat;
    const handBefore = await handoffCount(def);
    await forcePick(off);
    await expect.poll(() => handoffCount(def), { timeout: 25000 }).toBeGreaterThan(handBefore);
    def.proxy.block(true);
    await off.page.waitForFunction((seat) => { const m = (window as any).__borg.match; return m.phase !== 'live' && m.possession === 1 - seat; }, offSeat, { timeout: 15000 });
    const m2 = await off.page.evaluate(() => (window as any).__borg.match);
    expect(m2.last.possessor).toBe(1 - offSeat);
    def.proxy.block(false);
    await def.page.waitForFunction(() => (window as any).__room.net.status === 'open', undefined, { timeout: 20000 });
  } finally { await closePlayers(a, b); }
});
