import { expect, test } from '@playwright/test';

test('a full game on one device reaches the final screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local=1&bot=1&q=1&speed=6&dev=1');
  await page.waitForFunction(() => !!(window as any).__borg?.match, undefined, { timeout: 15000 });
  await expect(page.getByTestId('final')).toBeVisible({ timeout: 200000 });
  const m = await page.evaluate(() => { const b = (window as any).__borg; return { score: b.match.score, period: b.match.period, phase: b.match.phase, plays: b.stats.plays, winner: b.match.winner }; });
  expect(m.phase).toBe('final');
  expect(m.period).toBeGreaterThanOrEqual(4);
  expect(m.plays).toBeGreaterThan(8);
  await expect(page.getByTestId('final-score-0')).toHaveText(String(m.score[0]));
  expect(errors).toEqual([]);
});

test('a person can kick by keyboard, choose on 4th down by button and key, and a timeout reopens the choice', async ({ page }) => {
  await page.goto('/?local=1&q=1&dev=1');
  await page.waitForFunction(() => (window as any).__borg?.match?.phase === 'presnap' || (window as any).__borg?.match?.phase === 'kickChoice', undefined, { timeout: 15000 });
  // Get past the opening onside choice, kick it with two taps, and wait for a play from scrimmage.
  if (await page.evaluate(() => (window as any).__borg.match.phase === 'kickChoice')) await page.getByTestId('choice-deep').click();
  await page.waitForFunction(() => (window as any).__borg.match.play?.type === 'kickoff');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap' && (window as any).__borg.match.play?.type === 'scrimmage', undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const b = (window as any).__borg;
    b.net.core.onMessage(b.net.controllerConn(), JSON.stringify({ t: 'dev', op: 'patch', patch: { down: 4, toGo: 2, ballX: 50, chosen4th: false, phase: 'choice4th', play: null } }));
  });
  await expect(page.getByTestId('choice-go')).toBeVisible();
  await page.keyboard.press('1'); // Go for it
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap');
  await page.getByTestId('btn-timeout').click();
  await expect(page.getByTestId('choice-punt')).toBeVisible();
  await page.getByTestId('choice-go').click();
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap');
  const before = await page.evaluate(() => (window as any).__borg.match.play.playbook);
  await page.getByTestId('btn-audible').click();
  await page.waitForFunction((b) => (window as any).__borg.match.play.playbook !== b, before);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'live');
});
