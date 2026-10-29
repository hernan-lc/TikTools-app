import { expect, test } from '@playwright/test';

test('likes widget renders backend snapshots without summing events', async ({ page }) => {
  await page.goto('/likes/');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Record<string, unknown>)['__tiktoolsWidgetTest']))).toBe(true);
  await page.evaluate(() => {
    const hook = (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest;
    const snapshot = { topic: 'live.likes-ranking-full', data: { creatorId: 'creator', roomId: 'room', integrityStatus: 'degraded', leaders: [{ userId: '1', uniqueId: 'ana', nickname: 'Ana', rank: 1, score: 15 }] } };
    hook.emitEnvelope(snapshot);
    hook.emitEnvelope(snapshot);
  });
  await expect(page.getByText('Ranking incomplete')).toBeVisible();
  await expect(page.locator('.likes-row')).toHaveCount(1);
  await expect(page.locator('.likes-row')).toContainText('Ana');
  await expect(page.locator('.likes-row')).toContainText('15');
  await page.evaluate(() => {
    (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest.emitEnvelope({ topic: 'live.likes-ranking-full', data: { creatorId: 'creator', roomId: 'new-room', leaders: [] } });
  });
  await expect(page.locator('.likes-row')).toHaveCount(0);
  await expect(page.getByText('Ranking incomplete')).toHaveCount(0);
});
