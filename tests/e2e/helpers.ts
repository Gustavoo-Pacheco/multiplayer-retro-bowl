// Two real browser instances, each behind its own delay proxy.
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { NetProxy } from './proxy';

export interface Player { page: Page; browser: Browser; proxy: NetProxy; errors: string[]; base: string }

export function targetPort(baseURL: string | undefined): number {
  return Number(new URL(baseURL ?? 'http://localhost:5199').port || 80);
}

export const DESKTOP = { width: 1280, height: 720, touch: false };
export const PHONE = { width: 844, height: 390, touch: true };

export async function player(baseURL: string | undefined, view = DESKTOP): Promise<Player> {
  const proxy = await new NetProxy(targetPort(baseURL)).start();
  const browser = await chromium.launch();
  const base = `http://localhost:${proxy.port}`;
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: view.width, height: view.height }, hasTouch: view.touch, isMobile: view.touch, deviceScaleFactor: view.touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, browser, proxy, errors, base };
}

export async function closePlayers(...ps: Player[]): Promise<void> {
  for (const p of ps) { await p.browser.close().catch(() => {}); p.proxy.stop(); }
}

export const QS = 'dev=1&bot=1&speed=4';

/** Host creates, guest follows the invite link. Returns the room code. */
export async function makeRoom(a: Player, b: Player, qs = QS): Promise<string> {
  await a.page.goto(`/?${qs}`);
  await a.page.getByTestId('nick').fill('Ann');
  await a.page.getByTestId('create').click();
  const code = (await a.page.getByTestId('room-code').textContent())!;
  await b.page.goto(`/r/${code}?${qs}`);
  await b.page.getByTestId('nick').fill('Bea');
  await b.page.getByTestId('nick-go').click();
  await expect(b.page.getByTestId('seat-1')).toContainText('YOU');
  await expect(a.page.getByTestId('seat-1')).toContainText('Bea');
  return code;
}

export async function setOption(p: Page, key: string, value: string): Promise<void> {
  await p.getByTestId('tab-settings').click();
  await p.getByTestId(`cfg-${key}-${value}`).click();
  await expect(p.getByTestId(`cfg-${key}-${value}`)).toHaveClass(/\bon\b/);
}

export async function pickAndReady(a: Player, b: Player, teamA: string, teamB: string): Promise<void> {
  await a.page.getByTestId('tab-teams').click();
  await a.page.getByTestId(`team-${teamA}`).click();
  await expect(a.page.getByTestId('ready')).toBeEnabled();
  await b.page.getByTestId('tab-teams').click();
  await b.page.getByTestId(`team-${teamB}`).click();
  await expect(b.page.getByTestId('ready')).toBeEnabled();
  await a.page.getByTestId('ready').click();
  await expect(b.page.getByTestId('rival-ready')).toHaveText('ready');
  await b.page.getByTestId('ready').click();
  await a.page.waitForFunction(() => !!(window as any).__borg?.match, undefined, { timeout: 15000 });
  await b.page.waitForFunction(() => !!(window as any).__borg?.match, undefined, { timeout: 15000 });
}

export interface Snap {
  phase: string; period: number; clock: number; score: [number, number]; seat: number; ctrl: boolean; plays: number;
  framesSent: number; framesRecv: number; underruns: number; handoffs: number; yields: number; continues: number; worstHold: number; simPhase: string | null;
}

export async function snap(p: Page): Promise<Snap> {
  return p.evaluate(() => {
    const b = (window as any).__borg;
    return {
      phase: b.match?.phase, period: b.match?.period, clock: b.match?.clock, score: b.match?.score, seat: b.seat, ctrl: b.controlling(), plays: b.stats.plays,
      framesSent: b.stats.framesSent, framesRecv: b.stats.framesRecv, underruns: b.stats.watcherUnderruns, handoffs: b.stats.handoffs, yields: b.stats.yields, continues: b.stats.continues, worstHold: b.stats.worstHold,
      simPhase: b.sim?.phase ?? null,
    };
  });
}
