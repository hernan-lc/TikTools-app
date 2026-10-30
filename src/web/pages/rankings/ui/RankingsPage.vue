<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MetricDescriptor, RankingDefinition, RankingSource } from '@/entities/ranking/types.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseDisclosure from '@/shared/ui/disclosure/BaseDisclosure.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import BaseTabs from '@/shared/ui/tabs/BaseTabs.vue';
import CompetitionPanel from './CompetitionPanel.vue';
import { RankingController, parseRankingSnapshot, type RankingSnapshot } from '../../../../widgets/shared/ranking-controller.ts';

type Visualization = 'ranking' | 'bar' | 'pie' | 'donut' | 'poll' | 'roulette';

const { t } = useI18n();
const client = useControlClient();
const tab = ref<'rankings' | 'competitions'>('rankings');
const rankings = shallowRef<RankingDefinition[]>([]);
const metrics = shallowRef<MetricDescriptor[]>([]);
const selected = ref('');
const showForm = ref(false);
const snapshot = shallowRef<RankingSnapshot | null>(null);
const busy = ref(false);
const error = ref('');
const message = ref('');
const id = ref('');
const creator = ref('');
const room = ref('');
const group = ref<RankingDefinition['groupBy']>('user');
const limit = ref(10);
const windowType = ref<'session' | 'rolling' | 'daily'>('session');
const utcOffset = ref(-new Date().getTimezoneOffset());
const customSource = ref('');
const customMetric = ref('value');
const duration = ref(60);
const maxEvents = ref(10000);
const selectedMetric = ref('');
const sources = ref<RankingSource[]>([]);
const giftOverrides = ref<Record<string, { giftId: string; multiplier: number }[]>>({});
const limitUsers = ref(false);
const maxContributions = ref(0);
const cooldownMs = ref(0);
const maxUsers = ref(10000);
const editing = shallowRef<RankingDefinition | null>(null);
const resetOnUpdate = ref(false);
const advancedOpen = ref(false);
const liveHint = ref('');
const visualization = ref<Visualization>('ranking');
const showLabels = ref(true);
const showPercentages = ref(false);
const showLegend = ref(true);
const current = computed(() => rankings.value.find((ranking) => ranking.id === selected.value));
const tabs = computed(() => [
  { value: 'rankings' as const, label: t('rankingsPage.tabs.rankings') },
  { value: 'competitions' as const, label: t('rankingsPage.tabs.competitions') },
]);
const groups = ['user', 'gift', 'event_type', 'option', 'team', 'custom_key'] as const;
const windows = ['session', 'daily', 'rolling'] as const;
const visualizations: Visualization[] = ['ranking', 'bar', 'pie', 'donut', 'poll', 'roulette'];
/** Friendly names for native metrics; unknown or plugin metrics keep their technical name. */
const metricNames: Record<string, string> = {
  'tiktok.like|like.count': 'likes', 'tiktok.like|event.count': 'likePackets',
  'tiktok.gift|gift.diamonds': 'giftDiamonds', 'tiktok.gift|gift.count': 'giftCount', 'tiktok.gift|event.count': 'giftPackets',
  'tiktok.share|share.count': 'shares', 'tiktok.share|event.count': 'shareEvents',
  'tiktok.follow|event.count': 'follows', 'tiktok.social|event.count': 'social', 'tiktok.chat|event.count': 'chat',
  'tiktok.join|event.count': 'joins', 'points.awarded|points.delta': 'points', 'competition.vote|event.count': 'votes',
  'plugin.event|event.count': 'pluginEvents', 'plugin.event|value': 'pluginValue',
};
const presets = ['tiktok.gift|gift.diamonds', 'tiktok.like|like.count', 'tiktok.share|share.count', 'tiktok.follow|event.count', 'tiktok.chat|event.count', 'points.awarded|points.delta'];
const availablePresets = computed(() => presets.filter((key) => metrics.value.some((metric) => `${metric.source}|${metric.metric}` === key)));
let disposed = false;
let request = 0;
let snapshotController: RankingController | null = null;
function metricKey(metric: MetricDescriptor): string { return JSON.stringify([metric.source, metric.metric]); }
function sourceKey(source: RankingSource): string { return JSON.stringify([source.source, source.metric]); }
function metricLabel(source: string, metric: string): string {
  const name = metricNames[`${source}|${metric}`];
  return name ? t(`rankingsPage.metrics.${name}`) : `${source} · ${metric}`;
}
function windowLabel(definition: RankingDefinition): string {
  const window = definition.window;
  return window.type === 'rolling' ? t('rankingsPage.windows.rolling', { seconds: Math.round(window.durationMs / 1000) }) : t(`rankingsPage.windows.${window.type}`);
}
function summary(definition: RankingDefinition): string {
  return [definition.sources.map((source) => metricLabel(source.source, source.metric)).join(' + '), t(`rankingsPage.groups.${definition.groupBy}`), windowLabel(definition)].join(' · ');
}
function validInteger(value: number, max: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= max; }
async function refresh(): Promise<void> {
  try {
    const [list, descriptors] = await Promise.all([
      client.call<{ rankings: RankingDefinition[] }>('rankings.list', {}),
      client.call<{ metrics: MetricDescriptor[] }>('rankings.metrics', {}),
    ]);
    if (disposed) return;
    rankings.value = list.rankings;
    metrics.value = descriptors.metrics;
    if (!selectedMetric.value && metrics.value.length) selectedMetric.value = metricKey(metrics.value.find((metric) => metric.source === 'tiktok.like' && metric.metric === 'like.count') ?? metrics.value[0]!);
    if (selected.value && !rankings.value.some((item) => item.id === selected.value)) selected.value = '';
    if (!selected.value && !showForm.value && rankings.value.length) selected.value = rankings.value[0]!.id;
  } catch (failure) { if (!disposed) error.value = errorMessage(failure); }
}
async function loadSnapshot(): Promise<void> {
  const target = selected.value;
  const token = ++request;
  const initialSnapshot = snapshot.value;
  if (!target) { snapshot.value = null; return; }
  try {
    const result = await client.call<unknown>('rankings.snapshot', { id: target });
    if (!disposed && token === request && target === selected.value) {
      const envelope = { topic: 'ranking.updated', data: { snapshot: result } };
      const next = parseRankingSnapshot(envelope);
      // A push may have arrived while this request was in flight. An older
      // response from another instance cannot be ordered by revision.
      if (next && snapshot.value !== initialSnapshot && snapshot.value?.instanceId !== next.instanceId) return;
      snapshotController?.handleEnvelope(envelope);
    }
  } catch (failure) { if (!disposed && token === request) error.value = errorMessage(failure); }
}
function pushSource(source: string, metric: string): void {
  if (sources.value.some((item) => item.source === source && item.metric === metric)) return;
  sources.value.push({ source, metric, weight: 1, enabled: true });
  if (source === 'tiktok.gift') giftOverrides.value[JSON.stringify([source, metric])] = [];
}
function addPreset(key: string): void {
  const [source, metric] = key.split('|') as [string, string];
  pushSource(source, metric);
}
function addSource(): void {
  const metric = metrics.value.find((item) => metricKey(item) === selectedMetric.value);
  if (metric) pushSource(metric.source, metric.metric);
}
/** Plugin emits arrive as `plugin.<pluginId>.<eventType>`; agents use `custom.*`. */
function addCustomSource(): void {
  const source = customSource.value.trim(); const metric = customMetric.value.trim();
  if (!/^(plugin|custom)\.[\w.-]+$/.test(source) || source.length > 128 || !metric || metric.length > 128) { error.value = t('rankingsPage.form.invalidCustom'); return; }
  pushSource(source, metric); customSource.value = '';
}
function removeSource(index: number): void {
  const [removed] = sources.value.splice(index, 1);
  if (removed) delete giftOverrides.value[sourceKey(removed)];
}
async function useLive(): Promise<void> {
  liveHint.value = '';
  try {
    const status = await client.call<{ connected?: boolean; uniqueId?: string | null; roomId?: string | null }>('live.status', {});
    if (status?.uniqueId && status.roomId) { creator.value = status.uniqueId; room.value = status.roomId; return; }
  } catch { /* fall through to the hint */ }
  liveHint.value = t('rankingsPage.form.liveUnavailable');
}
function selectRanking(value: string): void {
  showForm.value = false; error.value = ''; message.value = '';
  if (editing.value) cancelEdit();
  selected.value = value;
}
function newRanking(): void {
  cancelEdit(); showForm.value = true; error.value = ''; message.value = '';
  void useLive();
}
function editRanking(): void {
  if (!current.value || !snapshot.value?.paused) return;
  const definition = current.value;
  editing.value = definition; showForm.value = true;
  id.value = definition.id; creator.value = definition.creatorId; room.value = definition.roomId;
  group.value = definition.groupBy; limit.value = definition.limit;
  windowType.value = definition.window.type;
  if (definition.window.type === 'rolling') { duration.value = definition.window.durationMs / 1000; maxEvents.value = definition.window.maxEvents; }
  if (definition.window.type === 'daily') utcOffset.value = definition.window.utcOffsetMinutes;
  sources.value = definition.sources.map((source) => ({ ...source }));
  giftOverrides.value = Object.fromEntries(definition.sources.filter((source) => source.source === 'tiktok.gift').map((source) => [sourceKey(source), Object.entries(source.giftMultipliers ?? {}).map(([giftId, multiplier]) => ({ giftId, multiplier }))]));
  limitUsers.value = !!definition.userLimits;
  maxContributions.value = definition.userLimits?.maxContributions ?? 0;
  cooldownMs.value = definition.userLimits?.cooldownMs ?? 0;
  maxUsers.value = definition.userLimits?.maxUsers ?? 10000;
  advancedOpen.value = limitUsers.value;
  resetOnUpdate.value = false; error.value = ''; message.value = '';
}
function cancelEdit(): void {
  editing.value = null; id.value = ''; creator.value = ''; room.value = ''; group.value = 'user';
  limit.value = 10; windowType.value = 'session'; utcOffset.value = -new Date().getTimezoneOffset(); duration.value = 60; maxEvents.value = 10000; sources.value = []; resetOnUpdate.value = false;
  limitUsers.value = false; maxContributions.value = 0; cooldownMs.value = 0; maxUsers.value = 10000;
  giftOverrides.value = {}; liveHint.value = ''; advancedOpen.value = false;
}
function closeForm(): void {
  cancelEdit(); showForm.value = false;
  if (!selected.value && rankings.value.length) selected.value = rankings.value[0]!.id;
}
async function create(): Promise<void> {
  error.value = ''; message.value = '';
  if (!id.value.trim() || !creator.value.trim() || !room.value.trim() || !sources.value.length
    || !validInteger(limit.value, 100000) || sources.value.some((source) => !Number.isSafeInteger(source.weight) || source.weight < 0 || source.weight > 1_000_000_000)
    || (limitUsers.value && (!validInteger(maxUsers.value, 100000) || !Number.isSafeInteger(maxContributions.value) || maxContributions.value < 0 || !Number.isSafeInteger(cooldownMs.value) || cooldownMs.value < 0 || (maxContributions.value === 0 && cooldownMs.value === 0)))
    || (windowType.value === 'rolling' && (!validInteger(duration.value * 1000, 86_400_000_000) || !validInteger(maxEvents.value, 100000)))
    || (windowType.value === 'daily' && (!Number.isSafeInteger(utcOffset.value) || Math.abs(utcOffset.value) > 840))) {
    error.value = t('rankingsPage.form.invalid'); return;
  }
  const voteSource = sources.value.some((source) => source.source === 'competition.vote');
  for (const source of sources.value.filter((item) => item.source === 'tiktok.gift')) {
    const rules = giftOverrides.value[sourceKey(source)] ?? [];
    const ids = rules.map((rule) => rule.giftId.trim());
    if (rules.length > 512 || ids.some((id) => !id || id.length > 128) || new Set(ids).size !== ids.length || rules.some((rule) => !Number.isSafeInteger(rule.multiplier) || rule.multiplier < 0 || rule.multiplier > 1_000_000_000)) {
      error.value = t('rankingsPage.form.invalidGift'); return;
    }
  }
  if ((voteSource && (group.value !== 'option' || windowType.value !== 'session' || limitUsers.value || sources.value.some((source) => !['competition.vote', 'tiktok.like', 'tiktok.share', 'tiktok.gift'].includes(source.source))))
    || (!voteSource && group.value === 'option' && sources.value.some((source) => !/^(plugin|custom)\./.test(source.source)))
    || (['team', 'custom_key'].includes(group.value) && sources.value.some((source) => !/^(plugin|custom)\./.test(source.source)))
    || (group.value === 'gift' && sources.value.some((source) => source.source !== 'tiktok.gift'))) {
    error.value = t('rankingsPage.form.invalidGroup'); return;
  }
  const definition: RankingDefinition = { ...editing.value, schemaVersion: 1, id: id.value.trim(), creatorId: creator.value.trim(), roomId: room.value.trim(), groupBy: group.value,
    window: windowType.value === 'session' ? { type: 'session' } : windowType.value === 'daily' ? { type: 'daily', utcOffsetMinutes: utcOffset.value } : { type: 'rolling', durationMs: duration.value * 1000, maxEvents: maxEvents.value },
    sources: sources.value.map((source) => {
      const result = { ...source };
      if (source.source === 'tiktok.gift') {
        const rules = giftOverrides.value[sourceKey(source)] ?? [];
        if (rules.length) result.giftMultipliers = Object.fromEntries(rules.map((rule) => [rule.giftId.trim(), rule.multiplier]));
        else delete result.giftMultipliers;
      }
      return result;
    }), limit: limit.value, capacity: editing.value?.capacity ?? 100000 };
  if (limitUsers.value) definition.userLimits = { maxContributions: maxContributions.value || null, cooldownMs: cooldownMs.value || null, maxUsers: maxUsers.value };
  else delete definition.userLimits;
  busy.value = true;
  try {
    const wasEditing = !!editing.value;
    if (wasEditing) await client.call('rankings.update', { definition, reset: resetOnUpdate.value });
    else await client.call('rankings.create', { ...definition });
    cancelEdit(); showForm.value = false;
    await refresh(); selected.value = definition.id; await loadSnapshot();
    message.value = wasEditing ? t('rankingsPage.form.updated') : t('rankingsPage.form.created');
  }
  catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
async function operation(method: 'pause' | 'resume' | 'reset'): Promise<void> {
  if (!selected.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await client.call(`rankings.${method}`, { id: selected.value }); await loadSnapshot(); }
  catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
async function copyUrl(): Promise<void> {
  if (!selected.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await client.call<{ ok: boolean }>('widgets.copyObsUrl', { widget: 'ranking', rankingId: selected.value, visualization: visualization.value, showLabels: showLabels.value, showPercentages: showPercentages.value, showLegend: showLegend.value });
    if (!result.ok) throw new Error(t('rankingsPage.detail.copyFailed'));
    message.value = t('rankingsPage.detail.copied');
  } catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
const maximum = computed(() => Math.max(1, ...(snapshot.value?.entries.map((entry) => entry.score) ?? [])));
watch(selected, (id) => { snapshotController?.dispose(); snapshot.value = null; snapshotController = id ? new RankingController(id, (value) => { snapshot.value = value; }) : null; void loadSnapshot(); });
let offTopic: (() => void) | undefined;
let offGap: (() => void) | undefined;
onMounted(() => {
  offTopic = client.onTopic('ranking.updated', (data) => {
    snapshotController?.handleEnvelope({ topic: 'ranking.updated', data });
  });
  offGap = client.onGap(() => { snapshotController?.clear(); void refresh(); void loadSnapshot(); });
  void refresh();
});
onBeforeUnmount(() => { disposed = true; request += 1; snapshotController?.dispose(); offTopic?.(); offGap?.(); });
</script>

<template>
  <main class="rankings-page">
    <header class="page-header">
      <h1>{{ t('rankingsPage.title') }}</h1>
      <p class="muted">
        {{ t('rankingsPage.subtitle') }}
      </p>
    </header>
    <p
      v-if="error"
      class="notice notice--error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      class="notice"
      role="status"
    >
      {{ message }}
    </p>
    <BaseTabs
      v-model="tab"
      :tabs="tabs"
    >
      <div
        v-if="tab === 'rankings'"
        class="workspace"
      >
        <BasePanel
          class="workspace__list"
          :title="t('rankingsPage.list.title')"
          flush
        >
          <template #actions>
            <BaseButton
              size="sm"
              variant="primary"
              @click="newRanking"
            >
              {{ t('rankingsPage.list.new') }}
            </BaseButton>
          </template>
          <ul
            v-if="rankings.length"
            class="ranking-list"
          >
            <li
              v-for="ranking in rankings"
              :key="ranking.id"
            >
              <button
                type="button"
                class="ranking-item"
                :class="{ 'ranking-item--active': !showForm && ranking.id === selected }"
                :data-ranking="ranking.id"
                @click="selectRanking(ranking.id)"
              >
                <strong>{{ ranking.id }}</strong>
                <span class="muted">{{ summary(ranking) }}</span>
              </button>
            </li>
          </ul>
          <p
            v-else
            class="muted list-empty"
          >
            {{ t('rankingsPage.list.emptyTitle') }}
          </p>
        </BasePanel>

        <BasePanel
          v-if="showForm"
          :title="editing ? t('rankingsPage.form.editTitle') : t('rankingsPage.form.createTitle')"
        >
          <form
            class="ranking-form"
            @submit.prevent="create"
          >
            <section class="step">
              <h2><span class="step__number">1</span>{{ t('rankingsPage.form.step1') }}</h2>
              <p class="muted">
                {{ t('rankingsPage.form.step1Hint') }}
              </p>
              <label class="field">{{ t('rankingsPage.form.id') }}<input
                v-model="id"
                maxlength="128"
                :disabled="!!editing"
                placeholder="top-gifters"
                required
              ><small class="muted">{{ t('rankingsPage.form.idHint') }}</small></label>
              <div class="row">
                <label class="field">{{ t('rankingsPage.form.creator') }}<input
                  v-model="creator"
                  maxlength="256"
                  required
                ></label>
                <label class="field">{{ t('rankingsPage.form.room') }}<input
                  v-model="room"
                  maxlength="256"
                  required
                ></label>
              </div>
              <div class="inline">
                <BaseButton
                  size="sm"
                  @click="useLive"
                >
                  {{ t('rankingsPage.form.useLive') }}
                </BaseButton>
                <small
                  v-if="liveHint"
                  class="muted"
                >{{ liveHint }}</small>
              </div>
            </section>

            <section class="step">
              <h2><span class="step__number">2</span>{{ t('rankingsPage.form.step2') }}</h2>
              <p class="muted">
                {{ t('rankingsPage.form.step2Hint') }}
              </p>
              <div
                v-if="availablePresets.length"
                class="chips"
                :aria-label="t('rankingsPage.form.presets')"
              >
                <button
                  v-for="preset in availablePresets"
                  :key="preset"
                  type="button"
                  class="chip"
                  :class="{ 'chip--on': sources.some((source) => `${source.source}|${source.metric}` === preset) }"
                  @click="addPreset(preset)"
                >
                  + {{ metricLabel(...(preset.split('|') as [string, string])) }}
                </button>
              </div>
              <ul
                v-if="sources.length"
                class="sources"
              >
                <li
                  v-for="(source, index) in sources"
                  :key="`${source.source}:${source.metric}`"
                  class="source"
                >
                  <div class="source__main">
                    <label class="check"><input
                      v-model="source.enabled"
                      type="checkbox"
                    >{{ metricLabel(source.source, source.metric) }}</label>
                    <label class="source__weight">{{ t('rankingsPage.form.weight') }} ×<input
                      v-model.number="source.weight"
                      type="number"
                      min="0"
                      max="1000000000"
                    ></label>
                    <BaseButton
                      size="sm"
                      @click="removeSource(index)"
                    >
                      {{ t('rankingsPage.form.remove') }}
                    </BaseButton>
                  </div>
                  <BaseDisclosure
                    v-if="source.source === 'tiktok.gift'"
                    :title="t('rankingsPage.form.giftMultipliers')"
                    :count="giftOverrides[sourceKey(source)]?.length ?? 0"
                  >
                    <p class="muted">
                      {{ t('rankingsPage.form.giftMultipliersHint') }}
                    </p>
                    <div
                      v-for="(rule, ruleIndex) in giftOverrides[sourceKey(source)]"
                      :key="ruleIndex"
                      class="gift-rule"
                    >
                      <label class="field">{{ t('rankingsPage.form.giftId') }}<input
                        v-model="rule.giftId"
                        maxlength="128"
                      ></label>
                      <label class="field">{{ t('rankingsPage.form.multiplier') }}<input
                        v-model.number="rule.multiplier"
                        type="number"
                        min="0"
                        max="1000000000"
                        step="1"
                      ></label>
                      <BaseButton
                        size="sm"
                        @click="giftOverrides[sourceKey(source)]?.splice(ruleIndex, 1)"
                      >
                        {{ t('rankingsPage.form.removeOverride') }}
                      </BaseButton>
                    </div>
                    <BaseButton
                      size="sm"
                      :disabled="(giftOverrides[sourceKey(source)]?.length ?? 0) >= 512"
                      @click="(giftOverrides[sourceKey(source)] ??= []).push({ giftId: '', multiplier: 1 })"
                    >
                      {{ t('rankingsPage.form.addGiftOverride') }}
                    </BaseButton>
                  </BaseDisclosure>
                </li>
              </ul>
              <p
                v-else
                class="muted empty-sources"
              >
                {{ t('rankingsPage.form.noSources') }}
              </p>
              <BaseDisclosure :title="t('rankingsPage.form.otherMetric')">
                <div class="row row--end">
                  <label class="field">{{ t('rankingsPage.form.otherMetric') }}<select v-model="selectedMetric"><option
                    v-for="metric in metrics"
                    :key="metricKey(metric)"
                    :value="metricKey(metric)"
                  >{{ metricLabel(metric.source, metric.metric) }} — {{ metric.description }}</option></select></label>
                  <BaseButton @click="addSource">
                    {{ t('rankingsPage.form.addMetric') }}
                  </BaseButton>
                </div>
                <div class="row row--end">
                  <label class="field">{{ t('rankingsPage.form.customSource') }}<input
                    v-model="customSource"
                    maxlength="128"
                    placeholder="plugin.my-plugin.answer"
                  ></label>
                  <label class="field field--narrow">{{ t('rankingsPage.form.customMetric') }}<select v-model="customMetric"><option value="value">value</option><option value="event.count">event.count</option></select></label>
                  <BaseButton @click="addCustomSource">
                    {{ t('rankingsPage.form.addCustomSource') }}
                  </BaseButton>
                </div>
              </BaseDisclosure>
            </section>

            <section class="step">
              <h2><span class="step__number">3</span>{{ t('rankingsPage.form.step3') }}</h2>
              <div class="row">
                <label class="field">{{ t('rankingsPage.form.groupBy') }}<select v-model="group"><option
                  v-for="value in groups"
                  :key="value"
                  :value="value"
                >{{ t(`rankingsPage.groups.${value}`) }}</option></select><small class="muted">{{ t(`rankingsPage.groupHints.${group}`) }}</small></label>
                <label class="field">{{ t('rankingsPage.form.window') }}<select v-model="windowType"><option
                  v-for="value in windows"
                  :key="value"
                  :value="value"
                >{{ value === 'rolling' ? t('rankingsPage.windows.rolling', { seconds: duration }) : t(`rankingsPage.windows.${value}`) }}</option></select><small class="muted">{{ t(`rankingsPage.windowHints.${windowType}`) }}</small></label>
              </div>
              <div
                v-if="windowType === 'rolling'"
                class="row"
              >
                <label class="field">{{ t('rankingsPage.form.duration') }}<input
                  v-model.number="duration"
                  type="number"
                  min="1"
                  max="86400000"
                ></label>
                <label class="field">{{ t('rankingsPage.form.maxEvents') }}<input
                  v-model.number="maxEvents"
                  type="number"
                  min="1"
                  max="100000"
                ></label>
              </div>
              <label
                v-if="windowType === 'daily'"
                class="field"
              >{{ t('rankingsPage.form.utcOffset') }}<input
                v-model.number="utcOffset"
                type="number"
                min="-840"
                max="840"
                step="15"
              ></label>
            </section>

            <BaseDisclosure
              v-model:open="advancedOpen"
              :title="t('rankingsPage.form.advanced')"
            >
              <div class="advanced">
                <label class="field">{{ t('rankingsPage.form.topEntries') }}<input
                  v-model.number="limit"
                  type="number"
                  min="1"
                  max="100000"
                ><small class="muted">{{ t('rankingsPage.form.topEntriesHint') }}</small></label>
                <label class="check"><input
                  v-model="limitUsers"
                  type="checkbox"
                > {{ t('rankingsPage.form.limitUsers') }}</label>
                <template v-if="limitUsers">
                  <label class="field">{{ t('rankingsPage.form.maxContributions') }}<input
                    v-model.number="maxContributions"
                    type="number"
                    min="0"
                    step="1"
                  ></label>
                  <label class="field">{{ t('rankingsPage.form.cooldown') }}<input
                    v-model.number="cooldownMs"
                    type="number"
                    min="0"
                    step="1"
                  ></label>
                  <label class="field">{{ t('rankingsPage.form.maxUsers') }}<input
                    v-model.number="maxUsers"
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                  ></label>
                </template>
              </div>
            </BaseDisclosure>

            <label
              v-if="editing"
              class="check"
            ><input
              v-model="resetOnUpdate"
              type="checkbox"
            > {{ t('rankingsPage.form.resetOnUpdate') }}</label>
            <div class="form-actions">
              <BaseButton
                type="submit"
                variant="primary"
                :disabled="busy"
              >
                {{ editing ? t('rankingsPage.form.save') : t('rankingsPage.form.create') }}
              </BaseButton>
              <BaseButton @click="closeForm">
                {{ t('rankingsPage.form.cancel') }}
              </BaseButton>
            </div>
          </form>
        </BasePanel>

        <BasePanel
          v-else-if="current"
          :title="current.id"
          :subtitle="summary(current)"
        >
          <template #actions>
            <span
              v-if="snapshot"
              class="badge"
              :class="snapshot.paused ? 'badge--muted' : snapshot.integrityStatus === 'degraded' ? 'badge--warn' : 'badge--ok'"
            >{{ snapshot.paused ? t('rankingsPage.status.paused') : snapshot.integrityStatus === 'degraded' ? t('rankingsPage.status.degraded') : t('rankingsPage.status.running') }}</span>
          </template>
          <div class="detail">
            <p
              v-if="!snapshot"
              class="muted"
            >
              {{ t('rankingsPage.detail.loading') }}
            </p>
            <template v-else>
              <dl class="stats">
                <div><dt>{{ t('rankingsPage.detail.participants') }}</dt><dd>{{ snapshot.totalParticipants.toLocaleString() }}</dd></div>
                <div><dt>{{ t('rankingsPage.detail.total') }}</dt><dd>{{ snapshot.totalScore.toLocaleString() }}</dd></div>
                <div><dt>{{ t('rankingsPage.detail.integrity') }}</dt><dd>{{ snapshot.integrityStatus === 'degraded' ? t('rankingsPage.detail.integrityDegraded') : t('rankingsPage.detail.integrityOk') }}</dd></div>
              </dl>
              <p
                v-if="snapshot.rejected || snapshot.dropped || snapshot.limited || snapshot.cooldownRejected"
                class="muted"
              >
                {{ t('rankingsPage.detail.issues', { rejected: snapshot.rejected, dropped: snapshot.dropped, limited: snapshot.limited, cooldown: snapshot.cooldownRejected }) }}
              </p>
              <ol
                v-if="snapshot.entries.length"
                class="leaderboard"
              >
                <li
                  v-for="entry in snapshot.entries"
                  :key="entry.key"
                >
                  <span class="leaderboard__rank">{{ entry.rank }}</span>
                  <span class="leaderboard__name">{{ entry.label }} — {{ entry.score }}</span>
                  <span
                    class="leaderboard__bar"
                    :style="{ width: `${(entry.score / maximum) * 100}%` }"
                  />
                </li>
              </ol>
              <p
                v-else
                class="muted"
              >
                {{ t('rankingsPage.detail.noEntries') }}
              </p>
            </template>
            <div class="toolbar">
              <BaseButton
                :disabled="busy"
                @click="operation(snapshot?.paused ? 'resume' : 'pause')"
              >
                {{ snapshot?.paused ? t('rankingsPage.detail.resume') : t('rankingsPage.detail.pause') }}
              </BaseButton>
              <BaseButton
                :disabled="busy || !snapshot?.paused"
                :title="snapshot?.paused ? undefined : t('rankingsPage.detail.editHint')"
                @click="editRanking"
              >
                {{ t('rankingsPage.detail.edit') }}
              </BaseButton>
              <BaseButton
                :disabled="busy"
                @click="operation('reset')"
              >
                {{ t('rankingsPage.detail.reset') }}
              </BaseButton>
              <BaseButton
                :disabled="busy"
                @click="loadSnapshot"
              >
                {{ t('rankingsPage.detail.refresh') }}
              </BaseButton>
            </div>
            <section class="obs">
              <h2>{{ t('rankingsPage.detail.obsTitle') }}</h2>
              <p class="muted">
                {{ t('rankingsPage.detail.obsHint') }}
              </p>
              <label class="field field--narrow">{{ t('rankingsPage.detail.visualization') }}<select v-model="visualization"><option
                v-for="value in visualizations"
                :key="value"
                :value="value"
              >{{ t(`rankingsPage.detail.visualizations.${value}`) }}</option></select></label>
              <div
                v-if="visualization !== 'roulette'"
                class="inline"
              >
                <label class="check"><input
                  v-model="showLabels"
                  type="checkbox"
                > {{ t('rankingsPage.detail.showLabels') }}</label>
                <label class="check"><input
                  v-model="showPercentages"
                  type="checkbox"
                > {{ t('rankingsPage.detail.showPercentages') }}</label>
                <label
                  v-if="visualization === 'pie' || visualization === 'donut'"
                  class="check"
                ><input
                  v-model="showLegend"
                  type="checkbox"
                > {{ t('rankingsPage.detail.showLegend') }}</label>
              </div>
              <BaseButton
                variant="primary"
                :disabled="busy"
                @click="copyUrl"
              >
                {{ t('rankingsPage.detail.copyUrl') }}
              </BaseButton>
            </section>
          </div>
        </BasePanel>

        <BasePanel
          v-else
          :title="t('rankingsPage.list.emptyTitle')"
        >
          <BaseEmptyState
            :title="t('rankingsPage.list.emptyTitle')"
            :description="t('rankingsPage.list.emptyHint')"
          />
          <div class="empty-action">
            <BaseButton
              variant="primary"
              @click="newRanking"
            >
              {{ t('rankingsPage.list.createFirst') }}
            </BaseButton>
          </div>
        </BasePanel>
      </div>
      <CompetitionPanel
        v-else
        :rankings="rankings"
      />
    </BaseTabs>
  </main>
</template>

<style scoped>
.rankings-page { display: grid; align-content: start; gap: var(--space-4); box-sizing: border-box; width: 100%; max-width: 1400px; padding: var(--space-5); color: var(--color-text); }
.page-header h1 { margin: 0 0 var(--space-1); }
.page-header p { margin: 0; max-width: 72ch; }
.muted { color: var(--color-text-muted); }
.notice { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--color-bg-control); border: 1px solid var(--color-border); }
.notice--error { color: var(--color-danger, #fb7185); border-color: currentColor; }
.workspace { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: var(--space-4); align-items: start; padding-top: var(--space-3); }
@media (max-width: 820px) { .workspace { grid-template-columns: 1fr; } }
.ranking-list { list-style: none; margin: 0; padding: var(--space-1); display: grid; gap: 2px; }
.ranking-item { display: grid; gap: 2px; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); color: inherit; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
.ranking-item:hover { background: var(--color-bg-control); }
.ranking-item--active { background: var(--color-bg-control); border-color: var(--color-accent, #3b82f6); }
.ranking-item span { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-empty { padding: var(--space-3); margin: 0; }
.ranking-form { display: grid; gap: var(--space-4); }
.step { display: grid; gap: var(--space-2); padding-bottom: var(--space-4); border-bottom: 1px solid var(--color-border); }
.step h2, .obs h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 15px; }
.step > p, .obs > p { margin: 0; font-size: 13px; }
.step__number { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; background: var(--color-accent, #3b82f6); color: #fff; }
.field { display: grid; gap: var(--space-1); flex: 1; min-width: 160px; }
.field small { font-size: 12px; }
.field--narrow { flex: 0 1 220px; }
.row { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.row--end { align-items: end; }
.inline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.check { display: inline-flex; align-items: center; gap: var(--space-2); }
input:not([type=checkbox]), select { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; color: var(--color-text); background: var(--color-bg-control); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip { padding: 4px 12px; border-radius: 999px; color: inherit; background: var(--color-bg-control); border: 1px solid var(--color-border); cursor: pointer; }
.chip:hover { border-color: var(--color-accent, #3b82f6); }
.chip--on { border-color: var(--color-accent, #3b82f6); background: color-mix(in srgb, var(--color-accent, #3b82f6) 18%, transparent); }
.sources { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.source { display: grid; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.source__main { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.source__main .check { flex: 1; font-weight: 600; }
.source__weight { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
.source__weight input { width: 90px; }
.empty-sources { margin: 0; padding: var(--space-2) var(--space-3); border: 1px dashed var(--color-border); border-radius: var(--radius-sm); }
.gift-rule { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); margin-bottom: var(--space-2); }
.advanced { display: grid; gap: var(--space-3); padding: var(--space-2) 0; }
.form-actions, .toolbar { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.detail { display: grid; gap: var(--space-4); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: 0; }
.stats div { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--color-bg-control); }
.stats dt { font-size: 12px; color: var(--color-text-muted); }
.stats dd { margin: 0; font-size: 20px; font-weight: 700; }
.leaderboard { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.leaderboard li { position: relative; display: flex; gap: var(--space-3); padding: 6px var(--space-2); overflow: hidden; border-radius: var(--radius-sm); }
.leaderboard__rank { min-width: 22px; font-weight: 700; color: var(--color-text-muted); }
.leaderboard__name { flex: 1; z-index: 1; }
.leaderboard__bar { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--color-accent, #3b82f6); opacity: .7; }
.obs { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--color-border); justify-items: start; }
.badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge--ok { background: color-mix(in srgb, #22c55e 20%, transparent); color: #4ade80; }
.badge--warn { background: color-mix(in srgb, #f59e0b 20%, transparent); color: #fbbf24; }
.badge--muted { background: var(--color-bg-control); color: var(--color-text-muted); }
.empty-action { display: flex; justify-content: center; padding-bottom: var(--space-4); }
</style>
