// The lobby's team wall and settings, at both sizes, without playing a game.
import { expect, test, type Page } from '@playwright/test';
import { closePlayers, DESKTOP, makeRoom, PHONE, player } from './helpers';

/** Text that was cut off or pushed out of its box, anywhere the lobby promises to show it in full. */
const clipped = (p: Page) => p.evaluate(() => {
  const bad: string[] = [];
  const shown = '.team-nick, .team-stats, .seat-card .scores, .seat-card .ready-word, .seat-nick, .cfg-row, .cfg-label';
  for (const el of document.querySelectorAll<HTMLElement>(shown)) {
    if (el.scrollWidth > el.clientWidth) bad.push(`cut off: ${el.textContent}`);
  }
  for (const el of document.querySelectorAll<HTMLElement>('.team-card')) {
    const box = el.getBoundingClientRect();
    for (const kid of el.querySelectorAll<HTMLElement>('.crest, .team-stats, .team-nick')) {
      const r = kid.getBoundingClientRect();
      if (r.left < box.left - 1 || r.right > box.right + 1) bad.push(`outside its tile: ${kid.textContent || 'crest'} in ${el.textContent}`);
    }
  }
  return bad;
});

/** Fails if pixels from the last screen were left behind: a forced full repaint must change nothing. */
const noLeftoverPixels = async (p: Page, label: string) => {
  const before = await p.screenshot();
  const hide = await p.addStyleTag({ content: '.lobby { visibility:hidden !important; }' });
  await p.screenshot();
  await hide.evaluate((n) => (n as HTMLStyleElement).remove());
  await p.waitForTimeout(100);
  expect(before.equals(await p.screenshot()), `${label} left pixels behind`).toBe(true);
};

const noSidewaysScroll = async (p: Page, label: string) => {
  expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${label} scrolls sideways`).toBeLessThanOrEqual(0);
};

for (const [size, view] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`team wall and settings at ${size} size`, async ({ baseURL }) => {
    const a = await player(baseURL, view);
    const b = await player(baseURL, view);
    try {
      await makeRoom(a, b, 'dev=1');
      await a.page.evaluate(() => document.fonts.ready);

      // Every team has a crest that actually drew, and its full name for screen readers.
      await expect(a.page.locator('.team-card')).toHaveCount(32);
      const blank = await a.page.locator('.team-card img.crest').evaluateAll((imgs) => imgs.filter((i) => !(i as HTMLImageElement).naturalWidth).length);
      expect(blank).toBe(0);
      await expect(a.page.getByTestId('team-SF')).toContainText('San Francisco 49ers');

      // Picks show on both players' cards and on the wall, with whose pick it is.
      await a.page.getByTestId('team-SEA').click();
      await b.page.getByTestId('team-LAR').click();
      await expect(b.page.getByTestId('seat-0')).toContainText('Seahawks');
      await expect(a.page.getByTestId('seat-1')).toContainText('Rams');
      await expect(a.page.getByTestId('team-SEA').locator('.flag-you')).toBeVisible();
      await expect(a.page.getByTestId('team-LAR').locator('.flag-rival')).toBeVisible();
      await expect(a.page.getByTestId('seat-1').getByTestId('team-next')).toHaveCount(0);
      expect(await clipped(a.page), 'team wall').toEqual([]);
      await noSidewaysScroll(a.page, 'team wall');

      // The arrows step through the wall's own order, and wrap at both ends.
      await a.page.getByTestId('sort-off').click();
      await expect(a.page.locator('.team-card').first()).toContainText('Los Angeles Rams');
      expect(await clipped(a.page), 'sorted wall').toEqual([]);
      await a.page.getByTestId('team-LAR').click();
      await expect(a.page.getByTestId('seat-0')).toContainText('Rams');
      await a.page.getByTestId('team-prev').click();
      await expect(a.page.getByTestId('seat-0')).toContainText('Las Vegas');
      await a.page.getByTestId('team-next').click();
      await expect(a.page.getByTestId('seat-0')).toContainText('Rams');
      await a.page.getByTestId('team-next').click();
      await expect(a.page.getByTestId('team-LAR')).toHaveAttribute('aria-pressed', 'false');
      await a.page.getByTestId('sort-division').click();

      // Ready locks the arrows along with the wall.
      await a.page.getByTestId('ready').click();
      await expect(b.page.getByTestId('rival-ready')).toHaveText('ready');
      await expect(a.page.getByTestId('team-next')).toBeDisabled();
      await expect(a.page.getByTestId('team-DAL')).toBeDisabled();
      await a.page.getByTestId('ready').click();
      await expect(a.page.getByTestId('ready')).toHaveText('READY');

      // Settings keep each option on one line, and booleans read the same way round.
      await a.page.getByTestId('tab-settings').click();
      await expect(a.page.locator('.cfg-row')).toHaveCount(22);
      await noLeftoverPixels(a.page, 'switching to settings');
      expect(await clipped(a.page), 'settings').toEqual([]);
      await noSidewaysScroll(a.page, 'settings');
      const tall = await a.page.locator('.cfg-row').evaluateAll((rows) => rows.filter((r) => (r as HTMLElement).offsetHeight > 40).map((r) => r.textContent));
      expect(tall, 'settings rows that wrapped').toEqual([]);
      for (const key of ['twoMinute', 'onside', 'injuries']) {
        const words = await a.page.locator(`[data-testid^="cfg-${key}-"]`).allTextContents();
        expect(words, key).toEqual(['Off', 'On']);
      }

      // A guest sees the same settings but can't change them.
      await b.page.getByTestId('tab-settings').click();
      await expect(b.page.getByTestId('readonly')).toBeVisible();
      await expect(b.page.getByTestId('preset-long')).toBeDisabled();
      expect(await clipped(b.page), 'guest settings').toEqual([]);

      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally {
      await closePlayers(a, b);
    }
  });
}

for (const [size, view] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`at ${size} size, an empty seat asks for the invite link, and the layout holds still when a team is picked`, async ({ baseURL }) => {
    const a = await player(baseURL, view);
    try {
      await a.page.goto('/?dev=1');
      await a.page.getByTestId('nick').fill('Ann');
      await a.page.getByTestId('create').click();
      await expect(a.page.getByTestId('seat-1')).toContainText('invite link');
      await expect(a.page.getByTestId('rival-ready')).toHaveCount(0);
      await expect(a.page.getByTestId('ready')).toBeDisabled();
      const before = await a.page.locator('.lobby-body').boundingBox();
      await a.page.getByTestId('team-next').click();
      await expect(a.page.getByTestId('ready')).toBeEnabled();
      const after = await a.page.locator('.lobby-body').boundingBox();
      expect(after!.y).toBe(before!.y);
      expect(a.errors).toEqual([]);
    } finally {
      await closePlayers(a);
    }
  });
}
