import { expect, test } from '@playwright/test';

test('ranking widget renders a shared snapshot in donut mode', async ({ page }) => {
  await page.goto('/ranking/?rankingId=vote&visualization=donut&showPercentages=true');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Record<string, unknown>)['__tiktoolsWidgetTest']))).toBe(true);
  await page.evaluate(() => {
    const hook = (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest;
    hook.emitEnvelope({ topic: 'ranking.updated', data: { snapshot: { rankingId: 'vote', schemaVersion: 1, creatorId: 'c', roomId: 'r', revision: 2, integrityStatus: 'unknown', paused: false, entries: [{ key: 'TNT', rank: 1, score: 30 }, { key: 'Zombies', rank: 2, score: 10 }], totalScore: 60, totalParticipants: 3 } } });
  });
  await expect(page.getByText('TNT')).toBeVisible();
  await expect(page.getByText('Zombies')).toBeVisible();
  await expect(page.locator('.chart.donut')).toBeVisible();
  await expect(page.locator('.chart.donut')).toContainText('60');
  await expect(page.locator('.other')).toContainText('20');
  await expect(page.getByText('50.0%')).toBeVisible();
});

test('roulette reveals only a stored winner and ignores duplicate refreshes', async ({ page }) => {
  await page.goto('/ranking/?rankingId=vote&visualization=roulette');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Record<string, unknown>)['__tiktoolsWidgetTest']))).toBe(true);
  const result = { topic: 'competition.result', data: { result: { schemaVersion: 1, competitionId: 'poll', rankingId: 'vote', generation: 1, selection: { mode: 'weighted_random', winner: 'TNT', eligible: [{ key: 'TNT', weight: 30 }, { key: 'Zombies', weight: 10 }] } } } };
  await page.evaluate((event) => (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest.emitEnvelope(event), result);
  await expect(page.getByText('Revealing winner…')).toBeVisible();
  await expect(page.getByText('Winner:')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('TNT')).toBeVisible();
  await page.evaluate((event) => (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest.emitEnvelope(event), result);
  await expect(page.getByText('Winner:')).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Record<string, unknown>)['__tiktoolsWidgetTest']))).toBe(true);
  await page.evaluate((event) => (window as unknown as { __tiktoolsWidgetTest: { emitEnvelope(value: unknown): void } }).__tiktoolsWidgetTest.emitEnvelope(event), result);
  await expect(page.getByText('TNT')).toBeVisible({ timeout: 5000 });
});
