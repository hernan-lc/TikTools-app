<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { MetricDescriptor, RankingDefinition, RankingSource } from '@/entities/ranking/types.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import CompetitionPanel from './CompetitionPanel.vue';
import { RankingController, parseRankingSnapshot, type RankingSnapshot } from '../../../../widgets/shared/ranking-controller.ts';

const client = useControlClient();
const rankings = shallowRef<RankingDefinition[]>([]);
const metrics = shallowRef<MetricDescriptor[]>([]);
const selected = ref('');
const snapshot = shallowRef<RankingSnapshot | null>(null);
const busy = ref(false);
const error = ref('');
const message = ref('');
const id = ref('');
const creator = ref('');
const room = ref('');
const group = ref<RankingDefinition['groupBy']>('user');
const limit = ref(10);
const windowType = ref<'session' | 'rolling'>('session');
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
const visualization = ref<'ranking' | 'bar' | 'pie' | 'donut' | 'poll' | 'roulette'>('ranking');
const showLabels = ref(true);
const showPercentages = ref(false);
const showLegend = ref(true);
const current = computed(() => rankings.value.find((ranking) => ranking.id === selected.value));
let disposed = false;
let request = 0;
let snapshotController: RankingController | null = null;
function metricKey(metric: MetricDescriptor): string { return JSON.stringify([metric.source, metric.metric]); }
function sourceKey(source: RankingSource): string { return JSON.stringify([source.source, source.metric]); }
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
function addSource(): void {
  const metric = metrics.value.find((item) => metricKey(item) === selectedMetric.value);
  if (!metric || sources.value.some((item) => item.source === metric.source && item.metric === metric.metric)) return;
  sources.value.push({ source: metric.source, metric: metric.metric, weight: 1, enabled: true });
  if (metric.source === 'tiktok.gift') giftOverrides.value[metricKey(metric)] = [];
}
function editRanking(): void {
  if (!current.value || !snapshot.value?.paused) return;
  const definition = current.value;
  editing.value = definition;
  id.value = definition.id; creator.value = definition.creatorId; room.value = definition.roomId;
  group.value = definition.groupBy; limit.value = definition.limit;
  windowType.value = definition.window.type;
  if (definition.window.type === 'rolling') { duration.value = definition.window.durationMs / 1000; maxEvents.value = definition.window.maxEvents; }
  sources.value = definition.sources.map((source) => ({ ...source }));
  giftOverrides.value = Object.fromEntries(definition.sources.filter((source) => source.source === 'tiktok.gift').map((source) => [sourceKey(source), Object.entries(source.giftMultipliers ?? {}).map(([giftId, multiplier]) => ({ giftId, multiplier }))]));
  limitUsers.value = !!definition.userLimits;
  maxContributions.value = definition.userLimits?.maxContributions ?? 0;
  cooldownMs.value = definition.userLimits?.cooldownMs ?? 0;
  maxUsers.value = definition.userLimits?.maxUsers ?? 10000;
  resetOnUpdate.value = false; error.value = ''; message.value = '';
}
function cancelEdit(): void {
  editing.value = null; id.value = ''; creator.value = ''; room.value = ''; group.value = 'user';
  limit.value = 10; windowType.value = 'session'; duration.value = 60; maxEvents.value = 10000; sources.value = []; resetOnUpdate.value = false;
  limitUsers.value = false; maxContributions.value = 0; cooldownMs.value = 0; maxUsers.value = 10000;
  giftOverrides.value = {};
}
async function create(): Promise<void> {
  error.value = ''; message.value = '';
  if (!id.value.trim() || !creator.value.trim() || !room.value.trim() || !sources.value.length
    || !validInteger(limit.value, 100000) || sources.value.some((source) => !Number.isSafeInteger(source.weight) || source.weight < 0 || source.weight > 1_000_000_000)
    || (limitUsers.value && (!validInteger(maxUsers.value, 100000) || !Number.isSafeInteger(maxContributions.value) || maxContributions.value < 0 || !Number.isSafeInteger(cooldownMs.value) || cooldownMs.value < 0 || (maxContributions.value === 0 && cooldownMs.value === 0)))
    || (windowType.value === 'rolling' && (!validInteger(duration.value * 1000, 86_400_000_000) || !validInteger(maxEvents.value, 100000)))) {
    error.value = 'Complete all fields and use valid positive limits and nonnegative integer weights.'; return;
  }
  const voteSource = sources.value.some((source) => source.source === 'competition.vote');
  for (const source of sources.value.filter((item) => item.source === 'tiktok.gift')) {
    const rules = giftOverrides.value[sourceKey(source)] ?? [];
    const ids = rules.map((rule) => rule.giftId.trim());
    if (rules.length > 512 || ids.some((id) => !id || id.length > 128) || new Set(ids).size !== ids.length || rules.some((rule) => !Number.isSafeInteger(rule.multiplier) || rule.multiplier < 0 || rule.multiplier > 1_000_000_000)) {
      error.value = 'Gift overrides require unique gift IDs and nonnegative integer multipliers.'; return;
    }
  }
  if ((voteSource && (group.value !== 'option' || windowType.value !== 'session' || limitUsers.value || sources.value.some((source) => !['competition.vote', 'tiktok.like', 'tiktok.share', 'tiktok.gift'].includes(source.source))))
    || (!voteSource && ['option', 'team', 'custom_key'].includes(group.value))
    || (group.value === 'gift' && sources.value.some((source) => source.source !== 'tiktok.gift'))) {
    error.value = 'Vote rankings require option grouping, a session window, and competition participation limits. Gift grouping requires gift metrics; team and custom routing are not yet available.'; return;
  }
  const definition: RankingDefinition = { ...editing.value, schemaVersion: 1, id: id.value.trim(), creatorId: creator.value.trim(), roomId: room.value.trim(), groupBy: group.value,
    window: windowType.value === 'session' ? { type: 'session' } : { type: 'rolling', durationMs: duration.value * 1000, maxEvents: maxEvents.value },
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
    await refresh(); selected.value = definition.id; if (wasEditing) { cancelEdit(); await loadSnapshot(); } else id.value = '';
    message.value = wasEditing ? 'Ranking updated.' : 'Ranking created.';
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
    if (!result.ok) throw new Error('Could not copy the widget URL.');
    message.value = 'OBS URL copied to the clipboard.';
  } catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
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
    <h1>Rankings &amp; competitions</h1>
    <p class="hint">
      Rankings use accepted host events. Polls can combine votes with eligible likes, shares, and gifts.
    </p>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
    >
      {{ message }}
    </p>
    <div class="columns">
      <BasePanel :title="editing ? 'Edit ranking' : 'Create ranking'">
        <form
          class="form"
          @submit.prevent="create"
        >
          <label>Ranking ID<input
            v-model="id"
            maxlength="128"
            :disabled="!!editing"
            required
          ></label>
          <label>Creator ID<input
            v-model="creator"
            maxlength="256"
            required
          ></label>
          <label>Room ID<input
            v-model="room"
            maxlength="256"
            required
          ></label>
          <label>Group by<select v-model="group"><option value="user">User</option><option value="gift">Gift</option><option value="event_type">Event type</option><option value="option">Option</option><option value="team">Team</option><option value="custom_key">Custom key</option></select></label>
          <label>Window<select v-model="windowType"><option value="session">Session</option><option value="rolling">Rolling</option></select></label>
          <template v-if="windowType === 'rolling'">
            <label>Duration (seconds)<input
              v-model.number="duration"
              type="number"
              min="1"
              max="86400000"
            ></label><label>Maximum events<input
              v-model.number="maxEvents"
              type="number"
              min="1"
              max="100000"
            ></label>
          </template>
          <label>Top entries<input
            v-model.number="limit"
            type="number"
            min="1"
            max="100000"
          ></label>
          <label><input v-model="limitUsers" type="checkbox"> Limit contributions per user</label>
          <template v-if="limitUsers">
            <label>Maximum contributions per user (0 for unlimited)<input v-model.number="maxContributions" type="number" min="0" step="1"></label>
            <label>Cooldown per user in milliseconds (0 for none)<input v-model.number="cooldownMs" type="number" min="0" step="1"></label>
            <label>Maximum tracked users<input v-model.number="maxUsers" type="number" min="1" max="100000" step="1"></label>
          </template>
          <label>Metric<select v-model="selectedMetric"><option
            v-for="metric in metrics"
            :key="metricKey(metric)"
            :value="metricKey(metric)"
          >{{ metric.source }} · {{ metric.metric }} — {{ metric.description }}</option></select></label>
          <BaseButton @click="addSource">
            Add metric
          </BaseButton>
          <ul class="sources">
            <li
              v-for="(source, index) in sources"
              :key="`${source.source}:${source.metric}`"
            >
              <label><input
                v-model="source.enabled"
                type="checkbox"
              >{{ source.source }} · {{ source.metric }}</label><label>Weight <input
                v-model.number="source.weight"
                type="number"
                min="0"
                max="1000000000"
              ></label><BaseButton @click="sources.splice(index, 1)">
                Remove
              </BaseButton>
              <template v-if="source.source === 'tiktok.gift'">
                <p>Gift overrides multiply this metric's weight. A multiplier of 0 disables the gift.</p>
                <div v-for="(rule, ruleIndex) in giftOverrides[sourceKey(source)]" :key="ruleIndex" class="gift-rule">
                  <label>Gift ID<input v-model="rule.giftId" maxlength="128"></label>
                  <label>Multiplier<input v-model.number="rule.multiplier" type="number" min="0" max="1000000000" step="1"></label>
                  <BaseButton @click="giftOverrides[sourceKey(source)]?.splice(ruleIndex, 1)">Remove override</BaseButton>
                </div>
                <BaseButton :disabled="(giftOverrides[sourceKey(source)]?.length ?? 0) >= 512" @click="(giftOverrides[sourceKey(source)] ??= []).push({ giftId: '', multiplier: 1 })">Add gift override</BaseButton>
              </template>
            </li>
          </ul>
          <label v-if="editing"><input v-model="resetOnUpdate" type="checkbox"> Reset scores when updating scoring or scope</label>
          <BaseButton
            type="submit"
            variant="primary"
            :disabled="busy"
          >
            {{ editing ? 'Save ranking' : 'Create ranking' }}
          </BaseButton>
          <BaseButton v-if="editing" @click="cancelEdit">Cancel edit</BaseButton>
        </form>
      </BasePanel>
      <BasePanel title="Ranking preview">
        <div class="form">
          <label>Ranking<select v-model="selected"><option value="">Select a ranking</option><option
            v-for="ranking in rankings"
            :key="ranking.id"
            :value="ranking.id"
          >{{ ranking.id }}</option></select></label>
          <template v-if="current">
            <p>{{ current.creatorId }} / {{ current.roomId }} · {{ current.groupBy }}</p>
            <p v-if="!snapshot">
              Loading snapshot…
            </p>
            <template v-else>
              <p>Participants: {{ snapshot.totalParticipants }} · Score: {{ snapshot.totalScore }} · {{ snapshot.integrityStatus }}<span v-if="snapshot.paused"> · Paused</span></p>
              <p v-if="snapshot.rejected || snapshot.dropped || snapshot.limited || snapshot.cooldownRejected">Rejected: {{ snapshot.rejected }} · Dropped: {{ snapshot.dropped }} · Limited: {{ snapshot.limited }} · Cooldown: {{ snapshot.cooldownRejected }}</p>
              <ol>
                <li
                  v-for="entry in snapshot.entries"
                  :key="entry.key"
                >
                  {{ entry.label }} — {{ entry.score }}
                </li>
              </ol><p v-if="!snapshot.entries.length">
                No contributions yet.
              </p>
            </template>
            <div class="actions">
              <BaseButton :disabled="busy || !snapshot?.paused" @click="editRanking">Edit definition</BaseButton>
              <BaseButton
                :disabled="busy"
                @click="operation(snapshot?.paused ? 'resume' : 'pause')"
              >
                {{ snapshot?.paused ? 'Resume' : 'Pause' }}
              </BaseButton><BaseButton
                :disabled="busy"
                @click="operation('reset')"
              >
                Reset
              </BaseButton><BaseButton
                :disabled="busy"
                @click="loadSnapshot"
              >
                Refresh
              </BaseButton>
            </div>
            <label>Visualization<select v-model="visualization"><option value="ranking">Leaderboard</option><option value="bar">Bar</option><option value="pie">Pie</option><option value="donut">Donut</option><option value="poll">Poll</option><option value="roulette">Winner reveal</option></select></label>
            <label><input v-model="showLabels" type="checkbox"> Show labels</label>
            <label><input v-model="showPercentages" type="checkbox"> Show percentages</label>
            <label v-if="visualization === 'pie' || visualization === 'donut'"><input v-model="showLegend" type="checkbox"> Show legend</label>
            <BaseButton
              :disabled="busy"
              @click="copyUrl"
            >
              Copy OBS URL
            </BaseButton>
          </template>
        </div>
      </BasePanel>
    </div>
    <CompetitionPanel :rankings="rankings" />
  </main>
</template>
<style scoped>
.rankings-page { padding: var(--space-5); color: var(--color-text); }
h1 { margin: 0 0 var(--space-3); } .hint { color: var(--color-text-muted); } .error { color: var(--color-danger, #fb7185); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: var(--space-4); align-items: start; }
.form { display: grid; gap: var(--space-3); } label { display: grid; gap: var(--space-1); } input:not([type=checkbox]), select { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; color: var(--color-text); background: var(--color-bg-control); border: 1px solid var(--color-border); border-radius: var(--radius-sm); } .sources { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); } .sources li { display: grid; gap: var(--space-2); border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2); } .sources li label:has(input[type=checkbox]) { display: flex; align-items: center; gap: var(--space-2); } .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
