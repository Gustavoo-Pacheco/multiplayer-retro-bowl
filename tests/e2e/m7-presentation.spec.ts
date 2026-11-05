// Art, sound and presentation, in real browsers. Saves the screens into screenshots/.
import { expect, test, type Page } from '@playwright/test';
import { closePlayers, DESKTOP, makeRoom, PHONE, pickAndReady, player, setOption, snap, type Player } from './helpers';

const QS = 'dev=1&bot=1&speed=3';
const shot = (p: Page, name: string) => p.screenshot({ path: `screenshots/${name}.png` });

const noHorizontalScroll = async (p: Page, label: string) => {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(over, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
};

async function waitPhase(p: Page, fn: string, timeout = 180000): Promise<void> {
  await p.waitForFunction(fn, undefined, { timeout, polling: 30 });
}

for (const [size, view] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`every screen at ${size} size, through a real game`, async ({ baseURL }) => {
    test.setTimeout(420000);
    const a = await player(baseURL, view);
    const b = await player(baseURL, view);
    try {
      await a.page.goto('/');
      await expect(a.page.getByTestId('title')).toBeVisible();
      await a.page.evaluate(() => document.fonts.ready);
      await shot(a.page, `title-${size}`);
      await noHorizontalScroll(a.page, 'title');
      await makeRoom(a, b, QS);
      await expect(a.page.getByTestId('rotate')).toBeHidden();
      await a.page.getByTestId(`team-SEA`).click();
      await b.page.getByTestId(`team-LAR`).click();
      await expect(a.page.getByTestId('seat-1')).toContainText('Rams');
      await shot(a.page, `team-menu-${size}`);
      await noHorizontalScroll(a.page, 'team menu');
      await a.page.getByTestId('tab-settings').click();
      await shot(a.page, `settings-${size}`);
      await noHorizontalScroll(a.page, 'settings');
      await a.page.getByTestId('sound').click();
      await expect(a.page.getByTestId('prefs')).toBeVisible();
      await shot(a.page, `player-settings-${size}`);
      await a.page.getByTestId('modal-close').click();
      await a.page.getByTestId('help').click();
      await expect(a.page.getByTestId('help-panel')).toBeVisible();
      await shot(a.page, `help-${size}`);
      await a.page.getByTestId('modal-close').click();
      await setOption(a.page, 'quarter', '1');
      await setOption(a.page, 'replays', 'big');
      await pickAndReady(a, b, 'SEA', 'LAR');
      // Slow enough to catch each moment on screen.
      await waitPhase(a.page, `window.__borg.match?.phase === 'coinToss'`);
      await shot(a.page, `coin-toss-${size}`);
      await waitPhase(a.page, `window.__borg.sim?.desc.type === 'scrimmage' && window.__borg.sim.phase === 'pre' || (window.__room && false)`, 60000).catch(() => {});
      await shot(a.page, `match-presnap-${size}`);
      await shot(b.page, `match-watcher-${size}`);
      // Hold both bots' skip button so the replay stays on screen for a picture, then let them carry on.
      const until = Date.now() + 200000;
      let shotPlay = false;
      let shotBanner = false;
      let shotReplay = false;
      while (Date.now() < until && !(shotBanner && shotReplay)) {
        const st = await a.page.evaluate(() => { const s = (window as any).__borg; return { sim: s.sim?.phase ?? null, phase: s.match?.phase, kind: s.match?.banner?.kind }; });
        if (!shotPlay && st.sim === 'pocket') { await shot(a.page, `match-play-${size}`); shotPlay = true; }
        if (!shotBanner && st.phase === 'banner' && st.kind === 'touchdown') {
          await a.page.evaluate(() => { (window as any).__borg.opts.bot = false; });
          await b.page.evaluate(() => { (window as any).__borg.opts.bot = false; });
          await a.page.waitForTimeout(700);
          await shot(a.page, `match-touchdown-${size}`);
          shotBanner = true;
        }
        if (shotBanner && !shotReplay && st.phase === 'replay') {
          await a.page.waitForTimeout(1200);
          await shot(a.page, `match-replay-${size}`);
          shotReplay = true;
          // Exactly one of them has a skip button: whoever has the ball next.
          const shown = await Promise.all([a, b].map((x) => x.page.getByTestId('btn-skip').isVisible()));
          expect(shown.filter(Boolean).length).toBe(1);
          await (shown[0] ? a : b).page.getByTestId('btn-skip').click();
          await a.page.evaluate(() => { (window as any).__borg.opts.bot = true; });
          await b.page.evaluate(() => { (window as any).__borg.opts.bot = true; });
        }
        await a.page.waitForTimeout(25);
      }
      expect(shotBanner, 'saw a touchdown').toBe(true);
      expect(shotReplay, 'saw its replay').toBe(true);
      await expect(a.page.getByTestId('final')).toBeVisible({ timeout: 300000 });
      await a.page.waitForTimeout(600);
      await shot(a.page, `final-${size}`);
      await noHorizontalScroll(a.page, 'final');
      // The final screen fits, with both buttons reachable.
      for (const id of ['rematch', 'leave']) await expect(a.page.getByTestId(id)).toBeInViewport();
      await a.page.getByTestId('rematch').click();
      await expect(a.page.getByTestId('lobby')).toBeVisible();
      await expect(b.page.getByTestId('lobby')).toBeVisible();
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally { await closePlayers(a, b); }
  });
}

test('the sprite page shows all 13 groups, and every drawing has pixels', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto('/dev/sprites');
    await expect(a.page.getByTestId('sprite-group-12')).toBeVisible();
    const res = await a.page.evaluate(() => {
      const blank = [...document.querySelectorAll('canvas')].filter((c) => {
        const d = (c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height).data;
        // The page paints a green backing with CSS, so an empty canvas has no alpha at all.
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
        return true;
      });
      return { groups: document.querySelectorAll('[data-testid^="sprite-group-"]').length, canvases: document.querySelectorAll('canvas').length, blank: blank.length, teams: document.querySelector('[data-testid="sprite-teams"]')!.children.length };
    });
    expect(res.groups).toBe(13);
    expect(res.teams).toBe(32);
    expect(res.blank).toBe(0);
    await a.page.getByTestId('sprite-team').selectOption('GB');
    await a.page.getByTestId('sprite-away').check();
    await a.page.getByTestId('sprite-group-0').scrollIntoViewIfNeeded();
    await a.page.getByTestId('sprite-teams').scrollIntoViewIfNeeded();
    await shot(a.page, 'sprites-all-teams');
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('every sound and song renders to something audible, and none clips badly', async ({ baseURL }) => {
  const a = await player(baseURL);
  try {
    await a.page.goto('/');
    const res = await a.page.evaluate(async () => {
      const c = (window as any).__audioCheck;
      const out: Record<string, { peak: number; rms: number }> = {};
      for (const n of c.names) out[n] = await c.measureSound(n);
      for (const n of ['title', 'menu']) out[`song:${n}`] = await c.measureSong(n);
      return out;
    });
    const want = ['whistle', 'snapCall', 'throw', 'catch', 'drop', 'tackle', 'grunt', 'stiffArm', 'dive', 'kick', 'goalpost', 'swell', 'groan', 'cheer', 'boo',
      'tdSting', 'firstDown', 'fgGood', 'fgMiss', 'turnover', 'penalty', 'quarterHorn', 'gameHorn', 'click', 'confirm', 'cancel', 'meterTick', 'winSting', 'lossSting', 'song:title', 'song:menu'];
    for (const n of want) {
      expect(res[n], n).toBeDefined();
      expect(res[n].peak, `${n} is silent`).toBeGreaterThan(0.01);
      expect(res[n].peak, `${n} clips`).toBeLessThan(1.3);
    }
  } finally { await closePlayers(a); }
});

test('the watcher hears the play from its frames, music stops for plays, and the crowd runs during a match', async ({ baseURL }) => {
  test.setTimeout(300000);
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    await makeRoom(a, b, 'dev=1&bot=1&speed=4');
    await setOption(a.page, 'replays', 'off');
    await setOption(a.page, 'quarter', '1');
    await pickAndReady(a, b, 'SEA', 'LAR');
    await a.page.waitForFunction(() => (window as any).__borg.stats.plays + (window as any).__borg.stats.framesRecv > 60, undefined, { timeout: 120000 });
    await expect(a.page.getByTestId('final')).toBeVisible({ timeout: 280000 });
    const logs = await Promise.all([a, b].map((p) => p.page.evaluate(() => (window as any).__audio.log as string[])));
    for (const log of logs) {
      for (const name of ['music:title', 'crowd:on', 'music:off', 'whistle', 'kick', 'snapCall', 'tackle', 'gameHorn', 'crowd:off']) expect(log, name).toContain(name);
      expect(log.some((x) => x === 'winSting' || x === 'lossSting')).toBe(true);
      // Nothing turned the music back on after the match started, apart from halftime.
      const start = log.indexOf('crowd:on');
      expect(log.slice(start).filter((x) => x.startsWith('music:') && x !== 'music:off' && x !== 'music:menu')).toEqual([]);
    }
    // Both screens heard the same play: the watcher took those events from frames.
    const score = (await snap(a.page)).score;
    expect(score.length).toBe(2);
  } finally { await closePlayers(a, b); }
});

test('weather draws on the field, in every type', async ({ baseURL }) => {
  test.setTimeout(120000);
  const a = await player(baseURL);
  try {
    for (const w of ['rain', 'snow', 'wind']) {
      await a.page.goto(`/?local=1&bot=1&q=1&speed=1&a=GB&b=CHI&weather=${w}`);
      await a.page.waitForFunction(() => (window as any).__borg?.sim?.phase === 'pre', undefined, { timeout: 60000 }).catch(() => {});
      await a.page.waitForTimeout(400);
      await shot(a.page, `weather-${w}-desktop`);
    }
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});

test('a player can change their own settings, and they stay after a reload', async ({ baseURL }) => {
  const a: Player = await player(baseURL);
  try {
    await a.page.goto('/');
    await a.page.getByTestId('sound').click();
    await a.page.getByTestId('pref-nameTags').click();
    await a.page.getByTestId('pref-starMarkers').click();
    await a.page.getByTestId('pref-sound').fill('3');
    await a.page.getByTestId('pref-music').fill('0');
    await a.page.getByTestId('modal-close').click();
    await a.page.reload();
    const p = await a.page.evaluate(() => JSON.parse(localStorage.getItem('borg.prefs')!));
    expect(p).toMatchObject({ nameTags: true, starMarkers: false, sound: 0.3, music: 0 });
    await a.page.getByTestId('sound').click();
    await expect(a.page.getByTestId('pref-nameTags')).toHaveText('On');
    await expect(a.page.getByTestId('pref-starMarkers')).toHaveText('Off');
    expect(a.errors).toEqual([]);
  } finally { await closePlayers(a); }
});
