import { expect, test } from '@playwright/test';
import { closePlayers, makeRoom, pickAndReady, player, setOption, snap } from './helpers';

test('two browsers finish a full game with a drop and a reload, and the watcher stays smooth at 150 ms', async ({ baseURL }) => {
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    const code = await makeRoom(a, b);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await setOption(a.page, 'quarter', '1');
    await setOption(a.page, 'replays', 'off');
    await pickAndReady(a, b, 'SEA', 'LAR');
    // Pages are loaded, so the added delay only affects the game connection.
    a.proxy.setDelay(150);
    b.proxy.setDelay(150);

    // Let the game run a few plays with delay, and measure the watcher.
    await a.page.waitForFunction(() => (window as any).__borg.stats.plays + 0 >= 0 && (window as any).__borg.stats.framesRecv + (window as any).__borg.stats.framesSent > 400, undefined, { timeout: 120000 });
    const sa = await snap(a.page);
    const sb = await snap(b.page);
    const frames = sa.framesRecv + sb.framesRecv;
    const under = sa.underruns + sb.underruns;
    console.log(`at 150 ms: frames received ${frames}, stutters ${under}, longest hold A ${sa.worstHold} B ${sb.worstHold}`);
    expect(frames).toBeGreaterThan(100);
    expect(under / frames).toBeLessThan(0.02);
    expect(Math.max(sa.worstHold, sb.worstHold)).toBeLessThan(400);

    a.proxy.setDelay(0);
    b.proxy.setDelay(0);

    // Network drop for the guest: the socket reconnects by itself and keeps its seat.
    b.proxy.disconnect();
    await expect.poll(async () => (await snap(b.page)).seat, { timeout: 15000 }).toBe(1);
    await expect.poll(() => b.page.evaluate(() => (window as any).__room.net.status), { timeout: 15000 }).toBe('open');

    // A full reload by the host: back in the same seat, in the same match.
    await a.page.reload();
    await a.page.waitForFunction(() => !!(window as any).__borg?.match, undefined, { timeout: 15000 });
    expect((await snap(a.page)).seat).toBe(0);

    // Both finish on the same final score.
    await expect(a.page.getByTestId('final')).toBeVisible({ timeout: 280000 });
    await expect(b.page.getByTestId('final')).toBeVisible({ timeout: 15000 });
    const fa = await snap(a.page);
    const fb = await snap(b.page);
    expect(fa.score).toEqual(fb.score);
    expect(fa.phase).toBe('final');
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);

    // Rematch keeps the room and settings and clears Ready.
    await b.page.getByTestId('rematch').click();
    await expect(a.page.getByTestId('lobby')).toBeVisible();
    await expect(b.page.getByTestId('lobby')).toBeVisible();
    await expect(a.page.getByTestId('room-code')).toHaveText(code);
    await a.page.getByTestId('tab-settings').click();
    await expect(a.page.getByTestId('cfg-quarter-1')).toHaveClass(/\bon\b/);
    await expect(a.page.getByTestId('ready')).toHaveText('READY');
  } finally {
    await closePlayers(a, b);
  }
});

test('lobby: a guest sees settings read-only, changes clear Ready, sorting works, and the same team gets the away kit', async ({ baseURL }) => {
  const a = await player(baseURL);
  const b = await player(baseURL);
  try {
    await makeRoom(a, b, 'dev=1');
    await a.page.getByTestId('team-SEA').click();
    await a.page.getByTestId('ready').click();
    await expect(b.page.getByTestId('rival-ready')).toHaveText('ready');
    await expect(a.page.getByTestId('team-DAL')).toBeDisabled();

    await a.page.getByTestId('tab-settings').click();
    await b.page.getByTestId('tab-settings').click();
    await expect(b.page.getByTestId('cfg-quarter-1')).toBeDisabled();
    await expect(b.page.getByTestId('readonly')).toBeVisible();
    await a.page.getByTestId('cfg-quarter-1').click();
    await expect(b.page.getByTestId('cfg-quarter-1')).toHaveClass(/\bon\b/);
    await expect(b.page.getByTestId('estimate')).toContainText('8 min');
    await expect(b.page.getByTestId('rival-ready')).toHaveText('not ready');

    await b.page.getByTestId('tab-teams').click();
    await b.page.getByTestId('sort-off').click();
    await expect(b.page.locator('.team-card').first()).toContainText('Los Angeles Rams');
    await b.page.getByTestId('sort-def').click();
    await expect(b.page.locator('.team-card').first()).toContainText('Seattle Seahawks');

    await a.page.getByTestId('tab-teams').click();
    await pickAndReady(a, b, 'SEA', 'SEA');
    const away = await a.page.evaluate(() => (window as any).__borg.match.away);
    expect(away).toEqual([false, true]);
    expect(a.errors).toEqual([]);
  } finally {
    await closePlayers(a, b);
  }
});
