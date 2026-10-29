import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeControlClient, storePlugins } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import RankingsPage from './RankingsPage.vue';

enableAutoUnmount(afterEach);
const definition = { schemaVersion: 1, id: 'top', creatorId: 'creator', roomId: 'room', groupBy: 'user', window: { type: 'session' }, sources: [{ source: 'tiktok.like', metric: 'like.count', weight: 1, enabled: true }], limit: 10, capacity: 100000 };
const snapshot = { rankingId: 'top', schemaVersion: 1, creatorId: 'creator', roomId: 'room', revision: 1, integrityStatus: 'unknown', paused: false, entries: [{ key: '42', label: 'Alice', rank: 1, score: 5 }], totalScore: 5, totalParticipants: 1 };
async function setup() {
  const { client, calls } = createFakeControlClient((method) => {
    if (method === 'automation.list') return { actions: [] };
    if (method === 'competitions.list') return { competitions: [] };
    if (method === 'rankings.list') return { rankings: [definition] };
    if (method === 'rankings.metrics') return { metrics: [{ source: 'tiktok.like', metric: 'like.count', description: 'Accepted likes', unit: 'likes' }] };
    if (method === 'rankings.snapshot') return snapshot;
    return { ok: true };
  });
  const wrapper = mountWithPlugins(RankingsPage, { global: { plugins: storePlugins(client) } });
  await flushPromises();
  return { wrapper, calls };
}
function button(wrapper: Awaited<ReturnType<typeof setup>>['wrapper'], name: string) {
  return wrapper.findAll('button').find((item) => item.text() === name)!;
}
describe('rankings management', () => {
  it('loads an authoritative snapshot and requests a scoped OBS URL', async () => {
    const { wrapper, calls } = await setup();
    const ranking = wrapper.findAll('select').find((item) => item.find('option[value="top"]').exists())!;
    await ranking.setValue('top');
    await flushPromises();
    expect(wrapper.text()).toContain('Alice — 5');
    const visualization = wrapper.findAll('select').find((item) => item.find('option[value="donut"]').exists())!;
    await visualization.setValue('donut');
    const percentages = wrapper.findAll('label').find((label) => label.text().includes('Show percentages'))!;
    await percentages.get('input').setValue(true);
    await button(wrapper, 'Copy OBS URL').trigger('click');
    await flushPromises();
    expect(calls.find((call) => call.method === 'widgets.copyObsUrl')?.params).toEqual({ widget: 'ranking', rankingId: 'top', visualization: 'donut', showLabels: true, showPercentages: true, showLegend: true });
  });
  it('creates a backend definition from the metric controls', async () => {
    const { wrapper, calls } = await setup();
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('new-rank');
    await inputs[1]!.setValue('creator');
    await inputs[2]!.setValue('room');
    await button(wrapper, 'Add metric').trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls.find((call) => call.method === 'rankings.create')?.params).toMatchObject({ id: 'new-rank', creatorId: 'creator', roomId: 'room', sources: [{ source: 'tiktok.like', metric: 'like.count', weight: 1, enabled: true }] });
  });
});
