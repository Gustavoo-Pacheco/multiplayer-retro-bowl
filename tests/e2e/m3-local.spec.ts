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
  await page.waitForFunction(() => (window as any).__borg.match.play?.type === 'scrimmage' && ['huddle', 'presnap'].includes((window as any).__borg.match.phase), undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const b = (window as any).__borg;
    b.net.core.onMessage(b.net.controllerConn(), JSON.stringify({ t: 'dev', op: 'patch', patch: { down: 4, toGo: 2, ballX: 50, chosen4th: false, phase: 'choice4th', play: null, huddle: null } }));
  });
  await expect(page.getByTestId('choice-go')).toBeVisible();
  await page.keyboard.press('1'); // Go for it
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'huddle');
  await expect(page.getByTestId('playbook')).toBeVisible();
  await page.getByTestId('btn-timeout').click();
  await expect(page.getByTestId('choice-punt')).toBeVisible();
  await expect(page.getByTestId('playbook')).toBeHidden();
  await page.getByTestId('choice-go').click();
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'huddle');
  // One screen: the offense calls first, by a card, then the defense takes the coach's pick with the space bar.
  await expect(page.getByTestId('playbook')).toHaveAttribute('data-side', 'off');
  await page.getByTestId('playbook-tab-run').click();
  await page.getByTestId('play-off-1').click();
  await expect(page.getByTestId('playbook')).toHaveAttribute('data-side', 'def');
  const defPick = Number(await page.getByTestId('playbook-coach').getAttribute('data-id'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap');
  expect(await page.evaluate(() => { const p = (window as any).__borg.match.play; return [p.playbook, p.defense]; })).toEqual([1, defPick]);
  await expect(page.getByTestId('playbook')).toBeHidden();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__borg.match.phase === 'live');
});

test('a running clock counts down between plays on one device, and plays still go through', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local=1&bot=1&q=1&clock=runs&speed=6&dev=1');
  await page.waitForFunction(() => !!(window as any).__borg?.match, undefined, { timeout: 15000 });
  type S = { phase: string; clock: number; period: number; run: boolean; id: number };
  const read = () => page.evaluate((): S => { const m = (window as any).__borg.match; return { phase: m.phase, clock: m.clock, period: m.period, run: m.runoffPending, id: m.playId }; });
  let last = await read();
  let ticks = 0;
  let wentUp = 0;
  const until = Date.now() + 120000;
  while (last.period < 2 && Date.now() < until) {
    await page.waitForTimeout(200);
    const s = await read();
    // The same dead ball, with the clock running: it moves on its own, and never back up.
    if (s.run && last.run && s.id === last.id && s.phase === last.phase && s.period === last.period && ['huddle', 'presnap', 'choice4th'].includes(s.phase)) {
      if (s.clock < last.clock) ticks += 1;
      if (s.clock > last.clock + 0.05) wentUp += 1;
    }
    last = s;
  }
  expect(last.period).toBeGreaterThanOrEqual(2);
  expect(ticks).toBeGreaterThan(5);
  expect(wentUp).toBe(0);
  expect(errors).toEqual([]);
});
