// The ?dev=1 tools, used through their real buttons. Everything here also runs against a deployed copy.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { closePlayers, makeRoom, pickAndReady, player, setOption } from './helpers';

const LOCAL = '/?local=1&bot=1&speed=4&q=1&a=SEA&b=LAR&dev=1';
const REMOTE = !!process.env.E2E_BASE_URL;

const openPanel = async (p: Page) => {
  await p.getByTestId('dev-toggle').click();
  await expect(p.getByTestId('dev-panel')).toBeVisible();
};

test('without ?dev=1 a match has no panel', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto('/?local=1&bot=1&speed=4&q=1&a=SEA&b=LAR');
    await expect(a.page.getByTestId('canvas')).toBeVisible();
    await expect(a.page.getByTestId('dev-toggle')).toHaveCount(0);
  } finally { await closePlayers(a); }
});

test('the tuning panel lists every number, edits it live, and can reset it', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    const counted = await a.page.evaluate(() => {
      const count = (o: object): number => Object.values(o).reduce((n: number, v) => n + (typeof v === 'number' ? 1 : v && typeof v === 'object' ? count(v) : 0), 0);
      return { want: count((window as any).__T), rows: document.querySelectorAll('.dev-line').length };
    });
    expect(counted.rows).toBe(counted.want);
    expect(counted.rows).toBeGreaterThan(100);
    await a.page.getByTestId('dev-filter').fill('ai.rushspeed');
    await expect(a.page.locator('.dev-line:visible')).toHaveCount(1);
    const before = await a.page.evaluate(() => (window as any).__T.ai.rushSpeed);
    const input = a.page.getByTestId('tune-ai.rushSpeed');
    await input.fill('0.25');
    await input.blur();
    expect(await a.page.evaluate(() => (window as any).__T.ai.rushSpeed)).toBe(0.25);
    await a.page.getByTestId('dev-copy').click();
    await expect(a.page.getByTestId('dev-note')).toContainText('ai.rushSpeed');
    // A cleared field keeps the number it had, so it can't turn into a broken value.
    await input.fill('');
    await input.blur();
    expect(await a.page.evaluate(() => (window as any).__T.ai.rushSpeed)).toBe(0.25);
    await a.page.getByTestId('dev-reset').click();
    expect(await a.page.evaluate(() => (window as any).__T.ai.rushSpeed)).toBe(before);
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('typing in the panel never reaches the game', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    await a.page.evaluate(() => { (window as any).__borg.opts.bot = false; });
    await a.page.getByTestId('dev-filter').click();
    await a.page.evaluate(() => { (window as any).__borg.queue.length = 0; });
    await a.page.keyboard.type(' a 1');
    await a.page.keyboard.press('ArrowRight');
    await expect(a.page.getByTestId('dev-filter')).toHaveValue(' a 1');
    expect(await a.page.evaluate(() => (window as any).__borg.queue.length)).toBe(0);
  } finally { await closePlayers(a); }
});

test('the bot switch gives the side to a person and back', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    await expect(a.page.getByTestId('dev-bot')).toHaveText('Bot: on');
    await a.page.getByTestId('dev-bot').click();
    await expect(a.page.getByTestId('dev-bot')).toHaveText('Bot: off');
    expect(await a.page.evaluate(() => (window as any).__borg.opts.bot)).toBe(false);
    await a.page.getByTestId('dev-bot').click();
    expect(await a.page.evaluate(() => (window as any).__borg.opts.bot)).toBe(true);
  } finally { await closePlayers(a); }
});

test('the force buttons give a sack, an interception and a fumble, each on the next play', async ({ baseURL }) => {
  test.setTimeout(180000);
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    const statTotal = (key: string) => a.page.evaluate((k) => {
      const st = (window as any).__borg.match.stats as Record<string, number>[];
      return st[0][k] + st[1][k];
    }, key);
    for (const [what, stat] of [['sack', 'sacks'], ['int', 'int'], ['fumble', 'fumLost']] as const) {
      const before = await statTotal(stat);
      await a.page.getByTestId(`dev-force-${what}`).click();
      await expect(a.page.getByTestId('dev-note')).toContainText('armed');
      await expect.poll(() => statTotal(stat), { timeout: 50000, message: what }).toBeGreaterThan(before);
    }
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('Low clock brings the end of the quarter close', async ({ baseURL }) => {
  test.setTimeout(120000);
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    await a.page.waitForFunction(() => (window as any).__borg.match?.phase === 'presnap' && (window as any).__borg.match.play?.type === 'scrimmage', undefined, { timeout: 60000 });
    const period = await a.page.evaluate(() => (window as any).__borg.match.period);
    await a.page.getByTestId('dev-low-clock').click();
    await expect.poll(() => a.page.evaluate(() => (window as any).__borg.match.clock), { timeout: 5000 }).toBeLessThanOrEqual(15);
    await a.page.waitForFunction((p) => (window as any).__borg.match.period > p, period, { timeout: 60000 });
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('Download last play saves its frames and state', async ({ baseURL }) => {
  test.setTimeout(120000);
  const a = await player(baseURL);
  try {
    await a.page.goto(LOCAL);
    await openPanel(a.page);
    await a.page.waitForFunction(() => (window as any).__borg.match?.last && (window as any).__borg.pres.replay.frames.length > 10, undefined, { timeout: 60000, polling: 30 });
    const input = a.page.getByTestId('tune-ai.rushSpeed');
    await input.fill('0.5');
    await input.blur();
    const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.getByTestId('dev-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/^borg-bowl-play-\d+\.json$/);
    const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
    expect(data.match.teams).toEqual(['SEA', 'LAR']);
    expect(data.frames.length).toBeGreaterThan(10);
    expect(typeof data.frames[0].px[0]).toBe('number');
    expect(data.tuning['ai.rushSpeed']).toBe(0.5);
    expect(data.desc).toBeTruthy();
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('online, the Fumble button on the offense hands the ball over mid-play', async ({ baseURL }) => {
  test.setTimeout(240000);
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    await makeRoom(a, b);
    await setOption(a.page, 'quarter', '1');
    await setOption(a.page, 'replays', 'off');
    await pickAndReady(a, b, 'SEA', 'LAR');
    for (const p of [a, b]) await openPanel(p.page);
    // Each player arms it. Whoever has the ball first gets the fumble.
    for (const p of [a, b]) await p.page.getByTestId('dev-force-fumble').click();
    await expect.poll(async () => {
      const st = await Promise.all([a, b].map((p) => p.page.evaluate(() => (window as any).__borg.stats.handoffs)));
      return st[0] + st[1];
    }, { timeout: 120000 }).toBeGreaterThan(0);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally { await closePlayers(a, b); }
});

test('Low clock is refused on a deployed server, and the panel says so', async ({ baseURL }) => {
  test.skip(!REMOTE, 'Only a deployed copy has the server dev tools switched off');
  test.setTimeout(120000);
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    await makeRoom(a, b);
    await pickAndReady(a, b, 'SEA', 'LAR');
    await a.page.waitForFunction(() => (window as any).__borg?.match?.phase === 'presnap', undefined, { timeout: 60000 });
    const clock = await a.page.evaluate(() => (window as any).__borg.match.clock);
    await openPanel(a.page);
    await a.page.getByTestId('dev-low-clock').click();
    await expect(a.page.getByTestId('dev-note')).toContainText('refused');
    expect(await a.page.evaluate(() => (window as any).__borg.match.clock)).toBeGreaterThan(15);
    expect(clock).toBeGreaterThan(15);
  } finally { await closePlayers(a, b); }
});
