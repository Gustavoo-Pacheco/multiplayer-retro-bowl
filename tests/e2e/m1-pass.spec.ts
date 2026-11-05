import { chromium, devices, expect, test } from '@playwright/test';

test('repeated pass plays by mouse', async ({ page }) => {
  await page.goto('/?practice=1');
  await page.waitForFunction(() => !!(window as any).__practice);
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  for (let i = 1; i <= 6; i++) {
    await page.waitForFunction((n) => (window as any).__practice.sim.desc.id === n && (window as any).__practice.sim.phase === 'pre', i);
    await page.mouse.click(...at(0.8, 0.5)); // snap
    await page.waitForFunction(() => (window as any).__practice.sim.phase === 'pocket');
    await page.mouse.move(...at(0.7, 0.5));
    await page.mouse.down();
    await page.mouse.move(...at(0.5, 0.48), { steps: 4 }); // drag away from the target
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForFunction((n) => (window as any).__practice.stats.plays >= n, i, { timeout: 15000 });
  }
  const stats = await page.evaluate(() => (window as any).__practice.stats);
  expect(stats.plays).toBeGreaterThanOrEqual(6);
  expect(stats.att).toBeGreaterThanOrEqual(4); // a sack before release is allowed
});

test('repeated pass plays by touch', async ({ baseURL }) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'], baseURL });
  const page = await ctx.newPage();
  await page.goto('/?practice=1');
  await page.waitForFunction(() => !!(window as any).__practice);
  const cdp = await ctx.newCDPSession(page);
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const pt = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  for (let i = 1; i <= 4; i++) {
    await page.waitForFunction((n) => (window as any).__practice.sim.desc.id === n && (window as any).__practice.sim.phase === 'pre', i);
    await page.touchscreen.tap(pt(0.85, 0.5).x, pt(0.85, 0.5).y);
    await page.waitForFunction(() => (window as any).__practice.sim.phase === 'pocket');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0.7, 0.5)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(0.6, 0.5)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(0.45, 0.48)] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction((n) => (window as any).__practice.stats.plays >= n, i, { timeout: 15000 });
  }
  const stats = await page.evaluate(() => (window as any).__practice.stats);
  expect(stats.att).toBeGreaterThanOrEqual(3);
  await browser.close();
});
