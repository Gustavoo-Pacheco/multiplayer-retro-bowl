import { chromium, expect, test } from '@playwright/test';

test('two browsers share a room, see each other\'s pointer, and reload keeps the seat', async ({ baseURL }) => {
  const bA = await chromium.launch();
  const bB = await chromium.launch();
  try {
    const a = await (await bA.newContext({ baseURL })).newPage();
    const b = await (await bB.newContext({ baseURL })).newPage();
    await a.goto('/');
    await a.getByTestId('nick').fill('Ann');
    await a.getByTestId('create').click();
    const code = (await a.getByTestId('room-code').textContent())!;
    await expect(a.getByTestId('seat-0')).toContainText('YOU: Ann');
    await b.goto(`/r/${code}`);
    await expect(b.getByTestId('seat-1')).toContainText('YOU:');
    await expect(a.getByTestId('seat-1')).toContainText('RIVAL:');

    const pad = await a.getByTestId('pad').boundingBox();
    await a.mouse.move(pad!.x + pad!.width * 0.5, pad!.y + pad!.height * 0.5);
    await a.mouse.move(pad!.x + pad!.width * 0.25, pad!.y + pad!.height * 0.75);
    await expect(b.getByTestId('rival-ptr')).toBeVisible();
    await expect(b.getByTestId('rival-ptr')).toHaveCSS('left', /.+/);

    await b.reload();
    await expect(b.getByTestId('seat-1')).toContainText('YOU:');
    await expect(a.getByTestId('seat-1')).toContainText('online');
  } finally {
    await bA.close();
    await bB.close();
  }
});
