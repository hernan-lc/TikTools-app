import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionTypeDefinition, LiveAction } from '../../../../automation/behavior/types.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import ActionEditor from './ActionEditor.vue';

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
});

const text = (value: string) => ({ default: value, i18key: '' });

const optionType = {
  id: 'test.hazard',
  title: text('Spawn hazard'),
  description: text('Spawns a hazard.'),
  tag: 'hazard',
  source: { kind: 'builtin' },
  requiredCapabilities: [],
  configSchema: { type: 'object', properties: {} },
  uiHints: { fields: { hazard: { optionsFrom: 'host.gifts' } } },
} as unknown as ActionTypeDefinition;

const action: LiveAction = {
  schemaVersion: 2,
  id: 'a1',
  name: 'Invoke tumbleweed',
  enabled: true,
  typeId: 'test.hazard',
  config: {},
};

function mountEditor(optionErrors: Record<string, string>) {
  return mountWithPlugins(ActionEditor, {
    attachTo: document.body,
    props: {
      action,
      actionTypes: [optionType],
      testRuns: [],
      globals: {},
      actionOptions: {},
      actionOptionErrors: optionErrors,
    },
  });
}

describe('ActionEditor option errors', () => {
  it('shows one compact row without an inline details section', async () => {
    const wrapper = mountEditor({ 'host.gifts': 'HTTP request failed' });
    await flushPromises();
    expect(wrapper.find('.base-alert__title').text()).toBe('Could not load the option list');
    expect(wrapper.find('.base-alert').classes()).toContain('base-alert--compact');
    expect(wrapper.find('.base-disclosure').exists()).toBe(false);
  });

  it('reveals the raw messages on hover', async () => {
    const wrapper = mountEditor({ 'host.gifts': 'HTTP request failed' });
    await flushPromises();
    vi.useFakeTimers();
    try {
      const alert = wrapper.get('.base-alert');
      alert.element.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(600);
      expect(document.getElementById('app-tooltip')?.textContent).toBe('HTTP request failed');
    } finally {
      vi.useRealTimers();
    }
  });
});
