<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CompetitionAction, CompetitionDefinition, CompetitionResult, CompetitionState } from '@/entities/competition/types.ts';
import type { RankingDefinition } from '@/entities/ranking/types.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseDisclosure from '@/shared/ui/disclosure/BaseDisclosure.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';

const props = defineProps<{ rankings: RankingDefinition[] }>();
const { t } = useI18n();
const client = useControlClient();
const showForm = ref(false);
const types = ['poll', 'team_battle', 'roulette', 'random_draw', 'weighted_draw', 'leaderboard_challenge'] as const;
const items = shallowRef<CompetitionDefinition[]>([]);
const actions = shallowRef<{ id: string; name: string; enabled?: boolean }[]>([]);
const selected = ref('');
const state = shallowRef<CompetitionState | null>(null);
const results = shallowRef<CompetitionResult[]>([]);
const action = shallowRef<CompetitionAction | null>(null);
const candidates = shallowRef<{ key: string; label: string; score: number }[]>([]);
const chosenWinner = ref('');
const candidateError = ref('');
const error = ref('');
const message = ref('');
const busy = ref(false);
const id = ref('');
const name = ref('');
const competitionType = ref<'poll' | 'team_battle' | 'roulette' | 'random_draw' | 'weighted_draw' | 'leaderboard_challenge'>('poll');
const targetScore = ref(0);
const userActionId = ref('');
let originalUserAction: CompetitionDefinition['onUserWin'] = null;
const challenge = computed(() => competitionType.value === 'leaderboard_challenge');
const userWinner = computed(() => ['leaderboard_challenge', 'random_draw', 'weighted_draw'].includes(competitionType.value));
const rankingId = ref('');
const duration = ref(0);
const voteLimit = ref(1);
const allowSwitch = ref(false);
const minimumParticipants = ref(1);
const tiePolicy = ref<CompetitionDefinition['tiePolicy']>('stable');
const mode = ref<CompetitionDefinition['selectionMode']>('highest_score');
type InputRow = { key: string; value: string; kind: 'string' | 'number' | 'boolean' };
const blankOption = () => ({ id: '', label: '', command: '', actionId: '', imageUrl: '', giftIds: '', originalAction: null as CompetitionDefinition['options'][number]['onWin'], inputs: [] as InputRow[] });
const options = ref([blankOption(), blankOption()]);
const editing = shallowRef<CompetitionDefinition | null>(null);
const eligibleRankings = computed(() => challenge.value ? props.rankings.filter((r) => !r.sources.some((s) => s.source === 'competition.vote')) : props.rankings.filter((r) => r.groupBy === 'option' && r.window.type === 'session' && r.sources.length > 0 && r.sources.some((s) => s.source === 'competition.vote' && s.metric === 'event.count') && r.sources.every((s) => ['competition.vote', 'tiktok.like', 'tiktok.share', 'tiktok.gift'].includes(s.source))));
let disposed = false;
let request = 0;
async function refresh(): Promise<void> {
  try {
    const response = await client.call<{ competitions: CompetitionDefinition[] }>('competitions.list', {});
    if (disposed) return;
    items.value = response.competitions;
    if (selected.value && !items.value.some((item) => item.id === selected.value)) selected.value = '';
    if (!selected.value && !showForm.value && items.value.length) selected.value = items.value[0]!.id;
  } catch (failure) { if (!disposed) error.value = errorMessage(failure); }
}
function selectCompetition(value: string): void {
  if (editing.value) cancelEdit();
  showForm.value = false; error.value = ''; message.value = '';
  selected.value = value;
}
function newCompetition(): void {
  cancelEdit(); showForm.value = true; error.value = ''; message.value = '';
}
function closeForm(): void {
  cancelEdit(); showForm.value = false;
  if (!selected.value && items.value.length) selected.value = items.value[0]!.id;
}
async function loadActions(): Promise<void> {
  try {
    const response = await client.call<{ actions: { id: string; name: string; enabled?: boolean }[] }>('automation.list', { kind: 'action' });
    if (!disposed) actions.value = response.actions.filter((action) => action.enabled !== false && typeof action.id === 'string');
  } catch (failure) { if (!disposed) error.value = errorMessage(failure); }
}
async function detail(): Promise<void> {
  const target = selected.value;
  const token = ++request;
  if (!target) { state.value = null; results.value = []; action.value = null; candidates.value = []; return; }
  try {
    const [next, history] = await Promise.all([
      client.call<CompetitionState>('competitions.state', { id: target }),
      client.call<{ results: CompetitionResult[] }>('competitions.results', { id: target }),
    ]);
    const nextAction = next.generation ? await client.call<{ action: CompetitionAction | null }>('competitions.action', { id: target, generation: next.generation }) : { action: null };
    let tied: { key: string; label: string; score: number }[] = [];
    let tiedError = '';
    const definition = items.value.find((item) => item.id === target);
    if (next.lifecycle === 'finalizing' && definition?.selectionMode === 'highest_score' && definition.tiePolicy === 'manual') {
      try {
        const response = await client.call<{ generation: number; candidates: typeof tied }>('competitions.candidates', { id: target });
        if (response.generation === next.generation) tied = response.candidates;
      } catch (failure) { tiedError = errorMessage(failure); }
    }
    if (!disposed && token === request && target === selected.value) { state.value = next; results.value = history.results; action.value = nextAction.action; candidates.value = tied; candidateError.value = tiedError; if (!tied.some((candidate) => candidate.key === chosenWinner.value)) chosenWinner.value = ''; }
  } catch (failure) { if (!disposed && token === request) error.value = errorMessage(failure); }
}
function editCompetition(): void {
  const definition = items.value.find((item) => item.id === selected.value);
  if (!definition || state.value?.lifecycle !== 'draft') return;
  editing.value = definition; showForm.value = true; id.value = definition.id; name.value = definition.name; rankingId.value = definition.rankingId;
  competitionType.value = definition.kind === 'weighted_poll' ? 'poll' : definition.kind;
  duration.value = (definition.durationMs ?? 0) / 1000; voteLimit.value = definition.voteLimit; allowSwitch.value = definition.allowSwitch;
  minimumParticipants.value = definition.minimumParticipants; tiePolicy.value = definition.tiePolicy; mode.value = definition.selectionMode;
  targetScore.value = definition.targetScore ?? 0; originalUserAction = definition.onUserWin ?? null; userActionId.value = originalUserAction?.actionId ?? '';
  options.value = definition.options.map((option) => ({ id: option.id, label: option.label, command: option.commands.join(', '), actionId: option.onWin?.actionId ?? '', imageUrl: option.imageUrl ?? '', giftIds: option.giftIds.join(', '), originalAction: option.onWin, inputs: Object.entries(option.onWin?.inputs ?? {}).flatMap(([key, value]): InputRow[] => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [{ key, value: String(value), kind: typeof value as InputRow['kind'] }] : []) }));
  error.value = ''; message.value = '';
}
function cancelEdit(): void {
  editing.value = null; id.value = ''; name.value = ''; rankingId.value = ''; competitionType.value = 'poll'; duration.value = 0; voteLimit.value = 1; allowSwitch.value = false; minimumParticipants.value = 1; tiePolicy.value = 'stable'; mode.value = 'highest_score'; options.value = [blankOption(), blankOption()];
  targetScore.value = 0; userActionId.value = ''; originalUserAction = null;
}
async function create(): Promise<void> {
  error.value = ''; message.value = '';
  const cleaned = options.value.map((option) => ({ id: option.id.trim(), label: option.label.trim(), commands: option.command.split(',').map((command) => command.trim()).filter(Boolean), actionId: option.actionId.trim(), imageUrl: option.imageUrl.trim(), giftIds: option.giftIds.split(',').map((gift) => gift.trim()).filter(Boolean), originalAction: option.originalAction, inputs: option.inputs }));
  const commands = cleaned.flatMap((option) => option.commands.map((command) => command.toLowerCase()));
  const gifts = cleaned.flatMap((option) => option.giftIds);
  for (const option of cleaned) {
    const keys = option.inputs.map((input) => input.key.trim());
    if (keys.some((key) => !key || key.length > 128) || new Set(keys).size !== keys.length || option.inputs.some((input) => input.kind === 'number' && (input.value.trim() === '' || !Number.isFinite(Number(input.value))) || input.kind === 'boolean' && !['true', 'false'].includes(input.value))) {
      error.value = t('competitionsPanel.form.invalidInputs'); return;
    }
  }
  if (challenge.value && (!id.value.trim() || !name.value.trim() || !eligibleRankings.value.some((ranking) => ranking.id === rankingId.value)
    || !Number.isSafeInteger(targetScore.value) || targetScore.value < 0 || !Number.isSafeInteger(minimumParticipants.value) || minimumParticipants.value < 1 || !Number.isSafeInteger(duration.value * 1000) || duration.value < 0 || duration.value > 86400000)) {
    error.value = t('competitionsPanel.form.invalidChallenge'); return;
  }
  if (!challenge.value && (!id.value.trim() || !name.value.trim() || !eligibleRankings.value.some((ranking) => ranking.id === rankingId.value)
    || cleaned.length < 1 || cleaned.some((option) => !option.id || !option.label || (option.commands.length === 0 && option.giftIds.length === 0) || option.commands.length > 64 || option.commands.some((command) => !/^!\S+$/.test(command)))
    || new Set(cleaned.map((option) => option.id)).size !== cleaned.length || new Set(commands).size !== commands.length
    || new Set(gifts).size !== gifts.length || cleaned.some((option) => option.giftIds.length > 256 || option.giftIds.some((gift) => !/^[1-9][0-9]{0,19}$/.test(gift) || BigInt(gift) > 18446744073709551615n))
    || !Number.isSafeInteger(voteLimit.value) || voteLimit.value < 1 || !Number.isSafeInteger(minimumParticipants.value) || minimumParticipants.value < 1 || !Number.isSafeInteger(duration.value * 1000) || duration.value < 0 || duration.value > 86400000)) {
    error.value = t('competitionsPanel.form.invalid'); return;
  }
  const definition: CompetitionDefinition = { schemaVersion: 1, id: id.value.trim(), name: name.value.trim(), kind: challenge.value ? 'leaderboard_challenge' : competitionType.value === 'weighted_draw' ? 'weighted_draw' : competitionType.value === 'random_draw' ? 'random_draw' : competitionType.value === 'team_battle' ? 'team_battle' : competitionType.value === 'roulette' ? 'roulette' : voteLimit.value === 1 && editing.value?.kind !== 'weighted_poll' ? 'poll' : 'weighted_poll', rankingId: rankingId.value,
    options: challenge.value ? [] : cleaned.map((option) => {
      const inputs: Record<string, unknown> = Object.create(null);
      if (option.originalAction?.actionId === option.actionId) for (const [key, value] of Object.entries(option.originalAction.inputs)) if (value === null || typeof value === 'object') inputs[key] = value;
      for (const input of option.inputs) inputs[input.key.trim()] = input.kind === 'number' ? Number(input.value) : input.kind === 'boolean' ? input.value === 'true' : input.value;
      return { id: option.id, label: option.label, commands: option.commands, giftIds: option.giftIds, imageUrl: option.imageUrl || null, onWin: option.actionId ? { actionId: option.actionId, inputs } : null };
    }),
    selectionMode: competitionType.value === 'weighted_draw' ? 'weighted_random' : competitionType.value === 'random_draw' ? 'uniform_random' : mode.value, tiePolicy: tiePolicy.value, durationMs: duration.value ? duration.value * 1000 : null, voteLimit: voteLimit.value, allowSwitch: allowSwitch.value, minimumParticipants: minimumParticipants.value,
    targetScore: challenge.value && targetScore.value > 0 ? targetScore.value : null,
    onUserWin: userWinner.value && userActionId.value ? { actionId: userActionId.value, inputs: originalUserAction?.actionId === userActionId.value ? originalUserAction.inputs : {} } : null };
  if (challenge.value) definition.selectionMode = 'highest_score';
  busy.value = true;
  try { const wasEditing = !!editing.value; await client.call(wasEditing ? 'competitions.update' : 'competitions.create', { ...definition }); cancelEdit(); showForm.value = false; await refresh(); selected.value = definition.id; await detail(); message.value = wasEditing ? t('competitionsPanel.form.updated') : t('competitionsPanel.form.created'); }
  catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
async function copyRevealUrl(): Promise<void> {
  const definition = items.value.find((item) => item.id === selected.value);
  if (!definition) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await client.call<{ ok: boolean }>('widgets.copyObsUrl', { widget: 'ranking', rankingId: definition.rankingId, visualization: 'roulette', competitionId: definition.id });
    if (!result.ok) throw new Error(t('competitionsPanel.operate.copyFailed'));
    message.value = t('competitionsPanel.operate.copied');
  } catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
async function operation(method: 'start' | 'pause' | 'resume' | 'finish' | 'cancel'): Promise<void> {
  if (!selected.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await client.call(`competitions.${method}`, { id: selected.value }); await detail(); }
  catch (failure) { error.value = errorMessage(failure); await detail(); } finally { busy.value = false; }
}
async function selectWinner(): Promise<void> {
  if (!selected.value || !state.value || !chosenWinner.value || !candidates.value.some((candidate) => candidate.key === chosenWinner.value)) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await client.call('competitions.selectWinner', { id: selected.value, generation: state.value.generation, winnerId: chosenWinner.value }); await detail(); }
  catch (failure) { error.value = errorMessage(failure); await detail(); } finally { busy.value = false; }
}
async function recoverAction(resolution: 'uncertain' | 'completed' | 'failed'): Promise<void> {
  if (!selected.value || !action.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    if (resolution === 'uncertain') await client.call('competitions.markActionUncertain', { id: selected.value, generation: action.value.generation });
    else await client.call('competitions.resolveAction', { id: selected.value, generation: action.value.generation, resolution });
    await detail();
  } catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
watch(selected, () => { state.value = null; results.value = []; action.value = null; candidates.value = []; chosenWinner.value = ''; candidateError.value = ''; void detail(); });
const subscriptions: (() => void)[] = [];
onMounted(() => {
  for (const topic of ['competition.started', 'competition.paused', 'competition.resumed', 'competition.finished', 'competition.cancelled', 'competition.action.completed', 'competition.action.failed']) {
    subscriptions.push(client.onTopic<{ competitionId?: string }>(topic, (data) => { if (data?.competitionId === selected.value) void detail(); }));
  }
  subscriptions.push(client.onGap(() => { void refresh(); void detail(); }));
  void refresh();
  void loadActions();
});
onBeforeUnmount(() => { disposed = true; request += 1; subscriptions.forEach((off) => off()); });
</script>
<template>
  <div class="competitions">
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
    <div class="workspace">
      <BasePanel
        :title="t('competitionsPanel.list.title')"
        flush
      >
        <template #actions>
          <BaseButton
            size="sm"
            variant="primary"
            @click="newCompetition"
          >
            {{ t('competitionsPanel.list.new') }}
          </BaseButton>
        </template>
        <ul
          v-if="items.length"
          class="item-list"
        >
          <li
            v-for="item in items"
            :key="item.id"
          >
            <button
              type="button"
              class="item"
              :class="{ 'item--active': !showForm && item.id === selected }"
              :data-competition="item.id"
              @click="selectCompetition(item.id)"
            >
              <strong>{{ item.name }}</strong>
              <span class="muted">{{ t(`competitionsPanel.types.${item.kind === 'weighted_poll' ? 'poll' : item.kind}.name`) }} · {{ item.rankingId }}</span>
            </button>
          </li>
        </ul>
        <p
          v-else
          class="muted list-empty"
        >
          {{ t('competitionsPanel.list.empty') }}
        </p>
      </BasePanel>

      <BasePanel
        v-if="showForm"
        :title="editing ? t('competitionsPanel.form.editTitle') : t('competitionsPanel.form.createTitle')"
      >
        <form
          class="competition-form"
          @submit.prevent="create"
        >
          <section class="step">
            <h2><span class="step__number">1</span>{{ t('competitionsPanel.form.step1') }}</h2>
            <div
              class="type-grid"
              role="radiogroup"
            >
              <label
                v-for="type in types"
                :key="type"
                class="type-card"
                :class="{ 'type-card--on': competitionType === type }"
              >
                <input
                  v-model="competitionType"
                  type="radio"
                  name="competition-type"
                  :value="type"
                >
                <strong>{{ t(`competitionsPanel.types.${type}.name`) }}</strong>
                <span class="muted">{{ t(`competitionsPanel.types.${type}.hint`) }}</span>
              </label>
            </div>
          </section>

          <section class="step">
            <h2><span class="step__number">2</span>{{ t('competitionsPanel.form.step2') }}</h2>
            <div class="row">
              <label class="field">{{ t('competitionsPanel.form.name') }}<input
                v-model="name"
                data-field="name"
                required
                maxlength="256"
              ></label>
              <label class="field">{{ t('competitionsPanel.form.id') }}<input
                v-model="id"
                data-field="id"
                :disabled="!!editing"
                required
                maxlength="128"
              ></label>
            </div>
            <label class="field">{{ challenge ? t('competitionsPanel.form.ranking') : t('competitionsPanel.form.voteRanking') }}<select
              v-model="rankingId"
              data-field="ranking"
            ><option value="">{{ t('competitionsPanel.form.chooseRanking') }}</option><option
              v-for="ranking in eligibleRankings"
              :key="ranking.id"
              :value="ranking.id"
            >{{ ranking.id }}</option></select><small class="muted">{{ challenge ? t('competitionsPanel.form.challengeRankingHint') : t('competitionsPanel.form.voteRankingHint') }}</small></label>
          </section>

          <section class="step">
            <h2><span class="step__number">3</span>{{ t('competitionsPanel.form.step3') }}</h2>
            <div class="row row--end">
              <label class="field">{{ t('competitionsPanel.form.duration') }}<input
                v-model.number="duration"
                type="number"
                min="0"
                max="86400000"
              ></label>
              <label
                v-if="!challenge"
                class="field"
              >{{ t('competitionsPanel.form.voteLimit') }}<input
                v-model.number="voteLimit"
                type="number"
                min="1"
              ></label>
              <label class="field">{{ t('competitionsPanel.form.minimumParticipants') }}<input
                v-model.number="minimumParticipants"
                type="number"
                min="1"
                max="100000"
              ></label>
              <label
                v-if="challenge"
                class="field"
              >{{ t('competitionsPanel.form.targetScore') }}<input
                v-model.number="targetScore"
                type="number"
                min="0"
                step="1"
              ></label>
            </div>
            <label
              v-if="!challenge"
              class="check"
            ><input
              v-model="allowSwitch"
              type="checkbox"
            > {{ t('competitionsPanel.form.allowSwitch') }}</label>
            <p
              v-if="competitionType === 'random_draw' || competitionType === 'weighted_draw'"
              class="muted"
            >
              {{ t('competitionsPanel.form.drawHint', { how: competitionType === 'random_draw' ? t('competitionsPanel.form.uniformly') : t('competitionsPanel.form.byScore') }) }}
            </p>
            <div class="row">
              <label
                v-if="!challenge && competitionType !== 'random_draw' && competitionType !== 'weighted_draw'"
                class="field"
              >{{ t('competitionsPanel.form.selection') }}<select v-model="mode"><option
                v-for="value in (['highest_score', 'uniform_random', 'weighted_random'] as const)"
                :key="value"
                :value="value"
              >{{ t(`competitionsPanel.form.selectionModes.${value}`) }}</option></select></label>
              <label
                v-if="competitionType !== 'random_draw' && competitionType !== 'weighted_draw' && (challenge || mode === 'highest_score')"
                class="field"
              >{{ t('competitionsPanel.form.tiePolicy') }}<select v-model="tiePolicy"><option
                v-for="value in (['stable', 'random', 'manual', 'no_winner'] as const)"
                :key="value"
                :value="value"
              >{{ t(`competitionsPanel.form.tiePolicies.${value}`) }}</option></select></label>
              <label
                v-if="userWinner"
                class="field"
              >{{ t('competitionsPanel.form.userAction') }}<select v-model="userActionId"><option value="">{{ t('competitionsPanel.form.noAction') }}</option><option
                v-for="available in actions"
                :key="available.id"
                :value="available.id"
              >{{ available.name || available.id }}</option></select></label>
            </div>
          </section>

          <section
            v-if="!challenge"
            class="step"
          >
            <h2><span class="step__number">4</span>{{ t('competitionsPanel.form.step4') }}</h2>
            <div class="options">
              <fieldset
                v-for="(option, index) in options"
                :key="index"
                class="option"
              >
                <legend>{{ t('competitionsPanel.form.option', { n: index + 1 }) }}</legend>
                <div class="row">
                  <label class="field field--narrow">{{ t('competitionsPanel.form.optionId') }}<input
                    v-model="option.id"
                    required
                    maxlength="128"
                    placeholder="a"
                  ></label>
                  <label class="field">{{ t('competitionsPanel.form.label') }}<input
                    v-model="option.label"
                    required
                    maxlength="256"
                  ></label>
                  <label class="field">{{ t('competitionsPanel.form.commands') }}<input
                    v-model="option.command"
                    placeholder="!vote"
                    maxlength="128"
                  ></label>
                </div>
                <BaseDisclosure :title="t('competitionsPanel.form.more')">
                  <div class="row">
                    <label class="field">{{ t('competitionsPanel.form.imageUrl') }}<input
                      v-model="option.imageUrl"
                      maxlength="2048"
                      type="url"
                    ></label>
                    <label class="field">{{ t('competitionsPanel.form.giftIds') }}<input
                      v-model="option.giftIds"
                      placeholder="123, 456"
                    ></label>
                  </div>
                  <label
                    v-if="!userWinner"
                    class="field"
                  >{{ t('competitionsPanel.form.winnerAction') }}<select
                    v-model="option.actionId"
                    @change="option.inputs = []; option.originalAction = null"
                  ><option value="">{{ t('competitionsPanel.form.noAction') }}</option><option
                    v-for="available in actions"
                    :key="available.id"
                    :value="available.id"
                  >{{ available.name || available.id }}</option></select></label>
                  <template v-if="option.actionId && !userWinner">
                    <div
                      v-for="(input, inputIndex) in option.inputs"
                      :key="inputIndex"
                      class="action-input"
                    >
                      <label class="field">{{ t('competitionsPanel.form.inputName') }}<input
                        v-model="input.key"
                        maxlength="128"
                      ></label>
                      <label class="field field--narrow">{{ t('competitionsPanel.form.valueType') }}<select v-model="input.kind"><option value="string">{{ t('competitionsPanel.form.types.string') }}</option><option value="number">{{ t('competitionsPanel.form.types.number') }}</option><option value="boolean">{{ t('competitionsPanel.form.types.boolean') }}</option></select></label>
                      <label class="field">{{ t('competitionsPanel.form.value') }}<input
                        v-if="input.kind !== 'boolean'"
                        v-model="input.value"
                      ><select
                        v-else
                        v-model="input.value"
                      ><option value="true">{{ t('competitionsPanel.form.true') }}</option><option value="false">{{ t('competitionsPanel.form.false') }}</option></select></label>
                      <BaseButton
                        size="sm"
                        @click="option.inputs.splice(inputIndex, 1)"
                      >
                        {{ t('competitionsPanel.form.removeInput') }}
                      </BaseButton>
                    </div>
                    <BaseButton
                      size="sm"
                      @click="option.inputs.push({ key: '', value: '', kind: 'string' })"
                    >
                      {{ t('competitionsPanel.form.addInput') }}
                    </BaseButton>
                  </template>
                </BaseDisclosure>
                <BaseButton
                  v-if="options.length > 1"
                  size="sm"
                  @click="options.splice(index, 1)"
                >
                  {{ t('competitionsPanel.form.removeOption') }}
                </BaseButton>
              </fieldset>
            </div>
            <BaseButton
              :disabled="options.length >= 256"
              @click="options.push(blankOption())"
            >
              {{ t('competitionsPanel.form.addOption') }}
            </BaseButton>
          </section>

          <div class="form-actions">
            <BaseButton
              type="submit"
              variant="primary"
              :disabled="busy"
            >
              {{ editing ? t('competitionsPanel.form.save') : t('competitionsPanel.form.create') }}
            </BaseButton>
            <BaseButton @click="closeForm">
              {{ t('competitionsPanel.form.cancel') }}
            </BaseButton>
          </div>
        </form>
      </BasePanel>

      <BasePanel
        v-else-if="selected && state"
        :title="items.find((item) => item.id === selected)?.name ?? selected"
        :subtitle="t('competitionsPanel.operate.generation', { n: state.generation })"
      >
        <template #actions>
          <span
            class="badge"
            :class="`badge--${state.lifecycle}`"
          >{{ t(`competitionsPanel.lifecycle.${state.lifecycle}`) }}</span>
        </template>
        <div class="detail">
          <p class="sr-only">
            {{ t('competitionsPanel.operate.status', { status: state.lifecycle }) }}
          </p>
          <p
            v-if="state.deadlineMs"
            class="muted"
          >
            {{ t('competitionsPanel.operate.ends', { time: new Date(state.deadlineMs).toLocaleString() }) }}
          </p>
          <p
            v-if="state.remainingMs !== null"
            class="muted"
          >
            {{ t('competitionsPanel.operate.remaining', { seconds: Math.ceil(state.remainingMs / 1000) }) }}
          </p>
          <p
            v-if="state.lifecycle === 'finalizing'"
            class="muted"
          >
            {{ t('competitionsPanel.operate.finalizing') }}
          </p>
          <div class="toolbar">
            <BaseButton
              v-if="state.lifecycle === 'draft'"
              variant="primary"
              :disabled="busy"
              @click="operation('start')"
            >
              {{ t('competitionsPanel.operate.start') }}
            </BaseButton>
            <BaseButton
              v-if="state.lifecycle === 'draft'"
              :disabled="busy"
              @click="editCompetition"
            >
              {{ t('competitionsPanel.operate.edit') }}
            </BaseButton>
            <BaseButton
              v-if="state.lifecycle === 'active'"
              :disabled="busy"
              @click="operation('pause')"
            >
              {{ t('competitionsPanel.operate.pause') }}
            </BaseButton>
            <BaseButton
              v-if="state.lifecycle === 'paused'"
              :disabled="busy"
              @click="operation('resume')"
            >
              {{ t('competitionsPanel.operate.resume') }}
            </BaseButton>
            <BaseButton
              v-if="['active', 'paused', 'finalizing', 'finished'].includes(state.lifecycle)"
              :disabled="busy"
              @click="operation('finish')"
            >
              {{ t('competitionsPanel.operate.finish') }}
            </BaseButton>
            <BaseButton
              v-if="['draft', 'active', 'paused'].includes(state.lifecycle)"
              :disabled="busy"
              @click="operation('cancel')"
            >
              {{ t('competitionsPanel.operate.cancel') }}
            </BaseButton>
            <BaseButton @click="detail">
              {{ t('competitionsPanel.operate.refresh') }}
            </BaseButton>
          </div>
          <div
            v-if="candidates.length"
            class="row row--end"
          >
            <label class="field">{{ t('competitionsPanel.operate.tiedWinner') }}<select v-model="chosenWinner"><option value="">{{ t('competitionsPanel.operate.chooseTied') }}</option><option
              v-for="candidate in candidates"
              :key="candidate.key"
              :value="candidate.key"
            >{{ candidate.label || candidate.key }} — {{ candidate.score }}</option></select></label>
            <BaseButton
              variant="primary"
              :disabled="busy || !chosenWinner"
              @click="selectWinner"
            >
              {{ t('competitionsPanel.operate.selectWinner') }}
            </BaseButton>
          </div>
          <p
            v-else-if="candidateError"
            class="notice notice--error"
          >
            {{ candidateError }}
          </p>
          <section class="block">
            <h3>{{ t('competitionsPanel.operate.history') }}</h3>
            <p
              v-if="!results.length"
              class="muted"
            >
              {{ t('competitionsPanel.operate.noResults') }}
            </p>
            <ul v-else>
              <li
                v-for="result in results"
                :key="result.generation"
              >
                {{ t('competitionsPanel.operate.result', { n: result.generation, winner: result.selection.winner ?? t('competitionsPanel.operate.noWinner') }) }}
              </li>
            </ul>
            <p v-if="action">
              {{ t('competitionsPanel.operate.action', { id: action.actionId, status: action.status }) }}<span v-if="action.reason"> ({{ action.reason }})</span>
            </p>
            <div
              v-if="action?.status === 'running'"
              class="toolbar"
            >
              <p class="muted">
                {{ t('competitionsPanel.operate.runningHint') }}
              </p>
              <BaseButton
                :disabled="busy"
                @click="recoverAction('uncertain')"
              >
                {{ t('competitionsPanel.operate.markUncertain') }}
              </BaseButton>
            </div>
            <div
              v-if="action?.status === 'uncertain'"
              class="toolbar"
            >
              <p class="muted">
                {{ t('competitionsPanel.operate.uncertainHint') }}
              </p>
              <BaseButton
                :disabled="busy"
                @click="recoverAction('completed')"
              >
                {{ t('competitionsPanel.operate.markCompleted') }}
              </BaseButton>
              <BaseButton
                :disabled="busy"
                @click="recoverAction('failed')"
              >
                {{ t('competitionsPanel.operate.markFailed') }}
              </BaseButton>
            </div>
          </section>
          <section class="block">
            <BaseButton
              :disabled="busy"
              @click="copyRevealUrl"
            >
              {{ t('competitionsPanel.operate.copyReveal') }}
            </BaseButton>
          </section>
        </div>
      </BasePanel>

      <BasePanel
        v-else
        :title="t('competitionsPanel.list.title')"
      >
        <div class="empty">
          <p class="muted">
            {{ t('competitionsPanel.list.empty') }}
          </p>
          <BaseButton
            variant="primary"
            @click="newCompetition"
          >
            {{ t('competitionsPanel.list.new') }}
          </BaseButton>
        </div>
      </BasePanel>
    </div>
  </div>
</template>

<style scoped>
.competitions { display: grid; gap: var(--space-3); padding-top: var(--space-3); color: var(--color-text); }
.muted { color: var(--color-text-muted); }
.notice { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--color-bg-control); border: 1px solid var(--color-border); }
.notice--error { color: var(--color-danger, #fb7185); border-color: currentColor; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.workspace { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
@media (max-width: 820px) { .workspace { grid-template-columns: 1fr; } }
.item-list { list-style: none; margin: 0; padding: var(--space-1); display: grid; gap: 2px; }
.item { display: grid; gap: 2px; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); color: inherit; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
.item:hover { background: var(--color-bg-control); }
.item--active { background: var(--color-bg-control); border-color: var(--color-accent, #3b82f6); }
.item span { font-size: 12px; }
.list-empty { padding: var(--space-3); margin: 0; }
.competition-form { display: grid; gap: var(--space-4); }
.step { display: grid; gap: var(--space-3); padding-bottom: var(--space-4); border-bottom: 1px solid var(--color-border); }
.step h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 15px; }
.step__number { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; background: var(--color-accent, #3b82f6); color: #fff; }
.type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: var(--space-2); }
.type-card { position: relative; display: grid; gap: 4px; padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; }
.type-card:hover { border-color: var(--color-accent, #3b82f6); }
.type-card--on { border-color: var(--color-accent, #3b82f6); background: color-mix(in srgb, var(--color-accent, #3b82f6) 14%, transparent); }
.type-card input { position: absolute; opacity: 0; pointer-events: none; }
.type-card span { font-size: 12px; }
.field { display: grid; gap: var(--space-1); flex: 1; min-width: 150px; }
.field small { font-size: 12px; }
.field--narrow { flex: 0 1 120px; min-width: 100px; }
.row { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.row--end { align-items: end; }
.check { display: inline-flex; align-items: center; gap: var(--space-2); }
input:not([type=checkbox]):not([type=radio]), select { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; color: var(--color-text); background: var(--color-bg-control); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.options { display: grid; gap: var(--space-3); }
.option { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.option legend { padding: 0 var(--space-1); font-weight: 600; }
.option > .base-button, .option > button { justify-self: start; }
.action-input { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); margin: var(--space-2) 0; }
.form-actions, .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.toolbar p { flex-basis: 100%; margin: 0; }
.detail { display: grid; gap: var(--space-3); }
.detail > p { margin: 0; }
.block { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--color-border); justify-items: start; }
.block h3 { margin: 0; font-size: 14px; }
.block ul { margin: 0; padding-left: var(--space-4); }
.badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--color-bg-control); color: var(--color-text-muted); }
.badge--active { background: color-mix(in srgb, #22c55e 20%, transparent); color: #4ade80; }
.badge--paused, .badge--finalizing { background: color-mix(in srgb, #f59e0b 20%, transparent); color: #fbbf24; }
.badge--failed, .badge--cancelled { background: color-mix(in srgb, #ef4444 18%, transparent); color: #f87171; }
.empty { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-4); }
</style>
