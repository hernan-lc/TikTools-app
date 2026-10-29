<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { MetricDescriptor, RankingDefinition, RankingSource } from '@/entities/ranking/types.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import CompetitionPanel from './CompetitionPanel.vue';
import { parseRankingSnapshot, type RankingSnapshot } from '../../../../widgets/shared/ranking-controller.ts';

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
const visualization = ref<'ranking' | 'bar' | 'pie' | 'donut' | 'poll' | 'roulette'>('ranking');
const showLabels = ref(true);
const showPercentages = ref(false);
const showLegend = ref(true);
const current = computed(() => rankings.value.find((ranking) => ranking.id === selected.value));
let disposed = false;
let request = 0;
function metricKey(metric: MetricDescriptor): string { return JSON.stringify([metric.source, metric.metric]); }
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
  if (!target) { snapshot.value = null; return; }
  try {
    const result = await client.call<unknown>('rankings.snapshot', { id: target });
    const next = parseRankingSnapshot({ topic: 'ranking.updated', data: { snapshot: result } });
    if (!disposed && token === request && target === selected.value && next) {
      if (!snapshot.value || snapshot.value.rankingId !== target || next.revision >= snapshot.value.revision) snapshot.value = next;
    }
  } catch (failure) { if (!disposed && token === request) error.value = errorMessage(failure); }
}
function addSource(): void {
  const metric = metrics.value.find((item) => metricKey(item) === selectedMetric.value);
  if (!metric || sources.value.some((item) => item.source === metric.source && item.metric === metric.metric)) return;
  sources.value.push({ source: metric.source, metric: metric.metric, weight: 1, enabled: true });
}
async function create(): Promise<void> {
  error.value = ''; message.value = '';
  if (!id.value.trim() || !creator.value.trim() || !room.value.trim() || !sources.value.length
    || !validInteger(limit.value, 100000) || sources.value.some((source) => !Number.isSafeInteger(source.weight) || source.weight < 0 || source.weight > 1_000_000_000)
    || (windowType.value === 'rolling' && (!validInteger(duration.value, 86_400_000) || !validInteger(maxEvents.value, 100000)))) {
    error.value = 'Complete all fields and use valid positive limits and nonnegative integer weights.'; return;
  }
  const voteSource = sources.value.some((source) => source.source === 'competition.vote');
  if ((voteSource && (group.value !== 'option' || windowType.value !== 'session' || sources.value.some((source) => !['competition.vote', 'tiktok.like', 'tiktok.share', 'tiktok.gift'].includes(source.source))))
    || (!voteSource && ['option', 'team', 'custom_key'].includes(group.value))
    || (group.value === 'gift' && sources.value.some((source) => source.source !== 'tiktok.gift'))) {
    error.value = 'Vote rankings require option grouping and a session window. Gift grouping requires gift metrics; team and custom routing are not yet available.'; return;
  }
  const definition: RankingDefinition = { schemaVersion: 1, id: id.value.trim(), creatorId: creator.value.trim(), roomId: room.value.trim(), groupBy: group.value,
    window: windowType.value === 'session' ? { type: 'session' } : { type: 'rolling', durationMs: duration.value * 1000, maxEvents: maxEvents.value },
    sources: sources.value.map((source) => ({ ...source })), limit: limit.value, capacity: 100000 };
  busy.value = true;
  try { await client.call('rankings.create', { ...definition }); await refresh(); selected.value = definition.id; id.value = ''; message.value = 'Ranking created.'; }
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
watch(selected, () => { snapshot.value = null; void loadSnapshot(); });
let offTopic: (() => void) | undefined;
let offGap: (() => void) | undefined;
onMounted(() => {
  offTopic = client.onTopic('ranking.updated', (data) => {
    const next = parseRankingSnapshot({ topic: 'ranking.updated', data });
    if (next && next.rankingId === selected.value && (!snapshot.value || next.revision >= snapshot.value.revision)) snapshot.value = next;
  });
  offGap = client.onGap(() => { snapshot.value = null; void refresh(); void loadSnapshot(); });
  void refresh();
});
onBeforeUnmount(() => { disposed = true; request += 1; offTopic?.(); offGap?.(); });
</script>

<template>
  <main class="rankings-page">
    <h1>Rankings &amp; competitions</h1>
    <p class="hint">
      Rankings use accepted host events. Command polls currently support vote-only rankings.
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
      <BasePanel title="Create ranking">
        <form
          class="form"
          @submit.prevent="create"
        >
          <label>Ranking ID<input
            v-model="id"
            maxlength="128"
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
            </li>
          </ul>
          <BaseButton
            type="submit"
            variant="primary"
            :disabled="busy"
          >
            Create ranking
          </BaseButton>
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
