import { chromium, devices, expect, test, type Page } from '@playwright/test';

/** Every runner gesture, on a phone-sized touch screen, using real touch events. */
test('every gesture works by touch on a phone', async ({ baseURL }) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'], baseURL });
  const page = await ctx.newPage();
  await page.goto('/?practice=1');
  await page.waitForFunction(() => !!(window as any).__practice);
  const cdp = await ctx.newCDPSession(page);
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const pt = (fx: number, fy: number) => ({ x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) });
  const touch = (type: string, points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points });
  const inputs = (p: Page) => p.evaluate(() => (window as any).__practice.inputLog as string[]);
  const clearInputs = (p: Page) => p.evaluate(() => { (window as any).__practice.inputLog.length = 0; });
  const sim = <T>(fn: string) => page.evaluate(`(s => (${fn}))(window.__practice.sim)`) as Promise<T>;
  const waitPlay = async (phase = 'pre') => { await page.waitForFunction((ph) => (window as any).__practice.sim.phase === ph, phase, { timeout: 15000 }); };
  const clearField = () => page.evaluate(() => { const s = (window as any).__practice.sim; for (const p of s.players) if (p.seat !== 0) { p.job = 'idle'; p.x = 115; } });

  // Handoff: a tap on the RB.
  const handoffPlay = async () => {
    await waitPlay('pre');
    await page.touchscreen.tap(pt(0.9, 0.6).x, pt(0.9, 0.6).y);
    await waitPlay('pocket');
    const rb = await page.evaluate(() => (window as any).__practice.screenOf(1));
    await page.touchscreen.tap(Math.round(rb.x), Math.round(rb.y));
    await waitPlay('run');
    await clearField();
    expect(await sim<number>('s.ball.holder')).toBe(1);
  };
  await handoffPlay();

  // Juke: swipe up.
  await clearInputs(page);
  const mid = pt(0.5, 0.5);
  await touch('touchStart', [mid]);
  await touch('touchMove', [{ x: mid.x, y: mid.y - 40 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window as any).__practice.inputLog.includes('swipe'));
  expect(await sim<number>('s.g.lastJukeAt')).toBeGreaterThan(0);

  // Slow: swipe back.
  await page.waitForTimeout(400);
  await touch('touchStart', [mid]);
  await touch('touchMove', [{ x: mid.x - 40, y: mid.y }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window as any).__practice.sim.g.slowT > 0);

  // Truck: press and hold still.
  await touch('touchStart', [mid]);
  await page.waitForFunction(() => (window as any).__practice.sim.g.truck === true, undefined, { timeout: 3000 });
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window as any).__practice.sim.g.truck === false);

  // Stiff arm: swipe toward a nearby defender.
  await page.evaluate(() => { const s = (window as any).__practice.sim; const r = s.players[1]; const d = s.players[8]; d.x = r.x + 1.5; d.y = r.y; d.tackleCd = 5; d.job = 'idle'; s.g.stiffsLeft = 2; });
  await touch('touchStart', [mid]);
  await touch('touchMove', [{ x: mid.x + 40, y: mid.y }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window as any).__practice.sim.g.stiffsLeft === 1 && (window as any).__practice.sim.g.stiffT > 0);
  await page.evaluate(() => { const d = (window as any).__practice.sim.players[8]; d.x = 115; });

  // Dive: swipe forward, with no defender near.
  await touch('touchStart', [mid]);
  await touch('touchMove', [{ x: mid.x + 40, y: mid.y }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window as any).__practice.sim.phase === 'dead');
  expect(await sim<string>('s.result.end')).toBe('tackle');
  expect(await inputs(page)).toContain('swipe');

  // QB run: a tap on the QB.
  await page.waitForFunction(() => (window as any).__practice.sim.phase === 'pre', undefined, { timeout: 10000 });
  await page.touchscreen.tap(pt(0.9, 0.6).x, pt(0.9, 0.6).y);
  await waitPlay('pocket');
  const qb = await page.evaluate(() => (window as any).__practice.screenOf(0));
  await page.touchscreen.tap(Math.round(qb.x), Math.round(qb.y));
  await waitPlay('run');
  expect(await sim<number>('s.ball.holder')).toBe(0);
  await page.waitForFunction(() => (window as any).__practice.sim.phase === 'pre', undefined, { timeout: 30000 });

  // Bullet pass: a second finger while aiming.
  await page.touchscreen.tap(pt(0.9, 0.6).x, pt(0.9, 0.6).y);
  await waitPlay('pocket');
  const a = pt(0.75, 0.3);
  const a2 = pt(0.6, 0.3);
  const other = pt(0.3, 0.8);
  await touch('touchStart', [a]);
  await touch('touchMove', [a2]);
  await page.waitForFunction(() => (window as any).__practice.sim.aim.on === true);
  await touch('touchStart', [a2, other]);
  await page.waitForFunction(() => (window as any).__practice.sim.aim.bullet === true);
  await touch('touchEnd', [a2]);
  await page.waitForTimeout(200);
  await touch('touchEnd', []);
  await browser.close();
});
