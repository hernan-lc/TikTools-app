import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { ActionTypeDefinition, BehaviorSnapshot, LiveAction, PluginStatus } from '../../../../automation/behavior/types.ts';
import type { ProcessorStatusEntry } from '../../../../shared/messages.ts';
import { useAutomationStore } from '@/entities/automation/model/automation-store.ts';
import { usePluginsStore } from '@/entities/plugin/model/plugins-store.ts';
import { createFakeControlClient, createStoreHarness } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import PluginsPage from './PluginsPage.vue';

enableAutoUnmount(afterEach);

const text = (value: string) => ({ default: value, i18key: '' });

beforeEach(() => {
  localStorage.clear();
});

function plugin(id: string, overrides: Partial<PluginStatus> = {}, descriptor: Partial<PluginStatus['descriptor']> = {}): PluginStatus {
  return {
    installed: true,
    enabled: true,
    available: true,
    ...overrides,
    descriptor: {
      id,
      source: 'user',
      name: text(id.toUpperCase()),
      version: '1.2.0',
      description: text(`The **${id}** integration.`),
      dependency: text('Local server'),
      permissions: ['network'],
      actionTypeIds: [`${id}.run`],
      eventTypeIds: [],
      ...descriptor,
    },
  };
}

const actionTypes = [
  { id: 'deck.run', title: 'Switch scene', tag: 'scenes', source: { kind: 'plugin', pluginId: 'deck' } },
] as unknown as ActionTypeDefinition[];

const actions = [{ id: 'a1', typeId: 'deck.run' }, { id: 'a2', typeId: 'deck.run' }] as unknown as LiveAction[];

const processor: ProcessorStatusEntry = {
  pluginId: 'deck',
  processorId: 'enrich',
  eventTypes: ['tiktok.chat'],
  timeoutMs: 250,
  priority: 1,
  status: 'ready',
  metrics: {
    calls: 12,
    successes: 11,
    failures: 1,
    timeouts: 0,
    skippedCircuitOpen: 0,
    skippedOverloaded: 0,
    averageLatencyMs: 4,
    maxLatencyMs: 9,
    lastError: 'boom',
  },
} as ProcessorStatusEntry;

async function mountPage(plugins: PluginStatus[] = [plugin('deck'), plugin('tts', { installed: false, enabled: false })]) {
  const { client, calls } = createFakeControlClient((method) => {
    if (method === 'processors.status') return { processors: [processor] };
    if (method === 'processors.test') {
      return { pluginId: 'deck', processorId: 'enrich', ok: true, durationMs: 3, result: { enriched: true } };
    }
    if (method === 'media.pick') return { selection: { type: 'file', file: { path: 'C:/x.plugin', name: 'x.plugin' } } };
    if (method === 'plugins.install') throw new Error('plugin already installed');
    return {};
  });
  const stores = createStoreHarness(client);
  const automation = stores.use(() => useAutomationStore()) as unknown as { behavior: BehaviorSnapshot };
  automation.behavior = { plugins, actions, actionTypes, events: [], translations: {} };
  const pluginsStore = stores.use(() => usePluginsStore());
  const wrapper = mountWithPlugins(PluginsPage, { attachTo: document.body, global: { plugins: stores.plugins } });
  await flushPromises();
  return { wrapper, calls, pluginsStore };
}

type Wrapper = VueWrapper;

function buttonByText(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)!;
}

async function selectPlugin(wrapper: Wrapper, name: string) {
  const option = wrapper.findAll('[role="option"]').find((item) => item.text().includes(name))!;
  await option.trigger('pointerdown');
}

describe('PluginsPage', () => {
  it('opens plugin details and returns to the catalog on narrow screens', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      const { wrapper } = await mountPage();
      await wrapper.get('.plugin-catalog__item').trigger('pointerdown');
      expect(wrapper.get('.plugin-details__name').text()).toBe('DECK');
      expect(wrapper.find('.plugin-catalog').exists()).toBe(false);
      await wrapper.get('.plugins-page__back').trigger('click');
      expect(wrapper.find('.plugin-details').exists()).toBe(false);
      expect(wrapper.find('.plugin-catalog').exists()).toBe(true);
      await wrapper.get('.plugin-catalog__item').trigger('pointerdown');
      expect(wrapper.get('.plugin-details__name').text()).toBe('DECK');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('lists installed and available plugins separately', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.findAll('[role="option"]').map((item) => item.text())).toEqual([expect.stringContaining('DECK')]);
    await buttonByText(wrapper, 'Available (1)').trigger('click');
    expect(wrapper.findAll('[role="option"]').map((item) => item.text())).toEqual([expect.stringContaining('TTS')]);
  });

  it('filters the catalog by search', async () => {
    const { wrapper } = await mountPage([plugin('deck'), plugin('vts')]);
    await wrapper.get('input[type="search"]').setValue('scenes');
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    await wrapper.get('input[type="search"]').setValue('nothing');
    expect(wrapper.text()).toContain('No plugins match “nothing”.');
  });

  it('shows details and toggles the plugin', async () => {
    const { wrapper, calls } = await mountPage();
    expect(wrapper.text()).toContain('Select a plugin to see its details.');
    await selectPlugin(wrapper, 'DECK');
    expect(wrapper.get('.plugin-details__name').text()).toBe('DECK');
    expect(wrapper.find('.base-markdown strong').text()).toBe('deck');
    expect(wrapper.text()).toContain('Switch scene');
    await wrapper.get('.plugin-details__controls input[type="checkbox"]').setValue(false);
    await flushPromises();
    expect(calls.find((call) => call.method === 'plugins.disable')?.params).toEqual({ pluginId: 'deck' });
  });

  it('confirms uninstall with the action usage', async () => {
    const { wrapper, calls } = await mountPage();
    await selectPlugin(wrapper, 'DECK');
    await buttonByText(wrapper, 'Uninstall…').trigger('click');
    await nextTick();
    expect(document.body.textContent).toContain('2 actions use it and will stop working.');
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Uninstall')!;
    confirm.click();
    await flushPromises();
    expect(calls.find((call) => call.method === 'plugins.uninstall')?.params).toEqual({ pluginId: 'deck' });
  });

  it('installs an available plugin', async () => {
    const { wrapper, calls } = await mountPage();
    await buttonByText(wrapper, 'Available (1)').trigger('click');
    await selectPlugin(wrapper, 'TTS');
    await buttonByText(wrapper, 'Activate').trigger('click');
    await flushPromises();
    expect(calls.find((call) => call.method === 'plugins.install.set')?.params).toEqual({ pluginId: 'tts', installed: true });
  });

  it('asks before replacing an installed package', async () => {
    const { wrapper, calls } = await mountPage();
    await buttonByText(wrapper, 'Install .plugin…').trigger('click');
    await flushPromises();
    expect(calls.find((call) => call.method === 'plugins.install')?.params).toEqual({ path: 'C:/x.plugin', replaceExisting: false });
    expect(wrapper.text()).toContain('This plugin is already installed. Replace it with the selected package?');
    await buttonByText(wrapper, 'Replace').trigger('click');
    await flushPromises();
    expect(calls.filter((call) => call.method === 'plugins.install').at(-1)?.params).toEqual({ path: 'C:/x.plugin', replaceExisting: true });
  });

  it('shows processor metrics and runs a test', async () => {
    const { wrapper, calls } = await mountPage();
    await buttonByText(wrapper, 'Processors').trigger('click');
    await flushPromises();
    expect(calls.map((call) => call.method)).toContain('processors.status');
    const row = wrapper.get('.processors tbody tr');
    expect(row.text()).toContain('enrich');
    expect(row.text()).toContain('Ready');
    await row.trigger('pointerdown');
    expect(wrapper.text()).toContain('boom');
    await buttonByText(wrapper, 'Test with sample event').trigger('click');
    await flushPromises();
    expect(calls.find((call) => call.method === 'processors.test')?.params).toMatchObject({ pluginId: 'deck', processorId: 'enrich' });
    expect(wrapper.text()).toContain('Succeeded in 3 ms');
  });

  it('restores the selected plugin from the view state', async () => {
    localStorage.setItem('tiktok-live-view-state', JSON.stringify({ version: 1, plugins: { selected: 'deck', view: 'plugins' } }));
    const { wrapper } = await mountPage();
    expect(wrapper.get('.plugin-details__name').text()).toBe('DECK');
  });
});
