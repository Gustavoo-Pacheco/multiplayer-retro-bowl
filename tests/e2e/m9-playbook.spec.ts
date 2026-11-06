// The playbook in the huddle, online in real browsers: both sides call in secret, then the play goes out with both calls.
// Saves the huddle screens into screenshots/.
import { expect, test, type Page } from '@playwright/test';
import { closePlayers, DESKTOP, makeRoom, PHONE, pickAndReady, player, setOption, type Player } from './helpers';

const shot = (p: Page, name: string) => p.screenshot({ path: `screenshots/${name}.png` });
const match = (p: Page) => p.evaluate(() => (window as any).__borg.match);

/** Lets the bots take the opening kickoff, then hands both screens back to people before the first huddle. */
async function toFirstHuddle(a: Player, b: Player): Promise<{ off: Player; def: Player }> {
  await a.page.waitForFunction(() => { const m = (window as any).__borg?.match; return m?.play?.type === 'kickoff' && m.phase === 'live'; }, undefined, { timeout: 60000, polling: 30 });
  for (const p of [a, b]) await p.page.evaluate(() => { (window as any).__borg.opts.bot = false; });
  await a.page.waitForFunction(() => { const m = (window as any).__borg.match; return m.phase === 'huddle' && m.play?.type === 'scrimmage'; }, undefined, { timeout: 90000, polling: 30 });
  const m = await match(a.page);
  const aSeat = await a.page.evaluate(() => (window as any).__borg.seat);
  return m.play.offense === aSeat ? { off: a, def: b } : { off: b, def: a };
}

for (const [size, view] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`each side calls its own play in secret, at ${size} size`, async ({ baseURL }) => {
    const a = await player(baseURL, view);
    const b = await player(baseURL, view);
    try {
      await makeRoom(a, b, 'dev=1&bot=1&speed=2');
      await setOption(a.page, 'replays', 'off');
      await pickAndReady(a, b, 'SEA', 'LAR');
      const { off, def } = await toFirstHuddle(a, b);
      await expect(off.page.getByTestId('playbook')).toHaveAttribute('data-side', 'off');
      await expect(def.page.getByTestId('playbook')).toHaveAttribute('data-side', 'def');
      await off.page.waitForTimeout(450); // the panel's slide-in
      await shot(off.page, `playbook-offense-${size}`);
      await shot(def.page, `playbook-defense-${size}`);
      // The offense calls a shot down the field from the deep tab.
      await off.page.getByTestId('playbook-tab-deep').click();
      const verts = off.page.locator('[data-testid^="play-off-"]').first();
      const id = Number((await verts.getAttribute('data-testid'))!.replace('play-off-', ''));
      await verts.click();
      await expect(off.page.getByTestId('playbook-locked')).toBeVisible();
      await shot(off.page, `playbook-locked-${size}`);
      // The defense knows a call is in, but not which.
      await def.page.waitForFunction(() => (window as any).__borg.match.huddle?.calls[0] === -2);
      const defPick = Number(await def.page.getByTestId('playbook-coach').getAttribute('data-id'));
      await def.page.getByTestId('playbook-coach').click();
      for (const p of [off, def]) await p.page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap', undefined, { timeout: 5000 });
      const play = (await match(def.page)).play;
      expect([play.playbook, play.defense]).toEqual([id, defPick]);
      await expect(off.page.getByTestId('playbook')).toBeHidden();
      expect([...a.errors, ...b.errors]).toEqual([]);
    } finally {
      await closePlayers(a, b);
    }
  });
}

test('with the computer on defense, the defense watches the huddle and the offense still has seven seconds', async ({ baseURL }) => {
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    await makeRoom(a, b, 'dev=1&bot=1&speed=2');
    await setOption(a.page, 'replays', 'off');
    await setOption(a.page, 'defense', 'computer');
    await pickAndReady(a, b, 'SEA', 'LAR');
    const { off, def } = await toFirstHuddle(a, b);
    await expect(def.page.getByTestId('playbook-watch')).toBeVisible();
    await expect(def.page.getByTestId('playbook')).toHaveCount(0);
    await expect(off.page.getByTestId('playbook')).toHaveAttribute('data-side', 'off');
    await def.page.waitForTimeout(450);
    await shot(def.page, 'playbook-watch-desktop');
    // Nobody calls: the coach's pick goes in when the time runs out.
    const pick = Number(await off.page.getByTestId('playbook-coach').getAttribute('data-id'));
    const at = Date.now();
    await off.page.waitForFunction(() => (window as any).__borg.match.phase === 'presnap', undefined, { timeout: 12000 });
    expect(Date.now() - at).toBeGreaterThan(4000);
    expect((await match(off.page)).play.playbook).toBe(pick);
  } finally {
    await closePlayers(a, b);
  }
});
