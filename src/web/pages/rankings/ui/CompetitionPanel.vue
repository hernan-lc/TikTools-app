<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { CompetitionAction, CompetitionDefinition, CompetitionResult, CompetitionState } from '@/entities/competition/types.ts';
import type { RankingDefinition } from '@/entities/ranking/types.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';

const props = defineProps<{ rankings: RankingDefinition[] }>();
const client = useControlClient();
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
  } catch (failure) { if (!disposed) error.value = errorMessage(failure); }
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
  editing.value = definition; id.value = definition.id; name.value = definition.name; rankingId.value = definition.rankingId;
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
      error.value = 'Action inputs require unique names and valid values.'; return;
    }
  }
  if (challenge.value && (!id.value.trim() || !name.value.trim() || !eligibleRankings.value.some((ranking) => ranking.id === rankingId.value)
    || !Number.isSafeInteger(targetScore.value) || targetScore.value < 0 || !Number.isSafeInteger(minimumParticipants.value) || minimumParticipants.value < 1 || !Number.isSafeInteger(duration.value * 1000) || duration.value < 0 || duration.value > 86400000)) {
    error.value = 'Choose an ordinary ranking and enter a valid target, duration and minimum participants.'; return;
  }
  if (!challenge.value && (!id.value.trim() || !name.value.trim() || !eligibleRankings.value.some((ranking) => ranking.id === rankingId.value)
    || cleaned.length < 1 || cleaned.some((option) => !option.id || !option.label || (option.commands.length === 0 && option.giftIds.length === 0) || option.commands.length > 64 || option.commands.some((command) => !/^!\S+$/.test(command)))
    || new Set(cleaned.map((option) => option.id)).size !== cleaned.length || new Set(commands).size !== commands.length
    || new Set(gifts).size !== gifts.length || cleaned.some((option) => option.giftIds.length > 256 || option.giftIds.some((gift) => !/^[1-9][0-9]{0,19}$/.test(gift) || BigInt(gift) > 18446744073709551615n))
    || !Number.isSafeInteger(voteLimit.value) || voteLimit.value < 1 || !Number.isSafeInteger(minimumParticipants.value) || minimumParticipants.value < 1 || !Number.isSafeInteger(duration.value * 1000) || duration.value < 0 || duration.value > 86400000)) {
    error.value = 'Choose a vote ranking and enter unique options, commands, gift IDs, and valid limits.'; return;
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
  try { const wasEditing = !!editing.value; await client.call(wasEditing ? 'competitions.update' : 'competitions.create', { ...definition }); await refresh(); selected.value = definition.id; if (wasEditing) { cancelEdit(); await detail(); } else { id.value = ''; name.value = ''; } message.value = wasEditing ? 'Competition updated.' : 'Competition created.'; }
  catch (failure) { error.value = errorMessage(failure); } finally { busy.value = false; }
}
async function copyRevealUrl(): Promise<void> {
  const definition = items.value.find((item) => item.id === selected.value);
  if (!definition) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await client.call<{ ok: boolean }>('widgets.copyObsUrl', { widget: 'ranking', rankingId: definition.rankingId, visualization: 'roulette', competitionId: definition.id });
    if (!result.ok) throw new Error('Could not copy the widget URL.');
    message.value = 'Winner reveal OBS URL copied.';
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
  <div class="competition-panels">
    <BasePanel :title="editing ? 'Edit competition' : 'Create competition'">
      <form
        class="form"
        @submit.prevent="create"
      >
        <p>Polls use a session ranking grouped by option with the competition vote metric. Likes, shares, and eligible gifts can add points after a viewer selects an option.</p>
        <p
          v-if="error"
          class="error"
          role="alert"
        >
          {{ error }}
        </p><p
          v-if="message"
          role="status"
        >
          {{ message }}
        </p>
        <label>Type<select v-model="competitionType"><option value="poll">Poll</option><option value="team_battle">Team battle</option><option value="roulette">Option roulette</option><option value="random_draw">Participant draw</option><option value="weighted_draw">Weighted participant draw</option><option value="leaderboard_challenge">Leaderboard challenge</option></select></label>
        <label>Competition ID<input
          v-model="id"
          :disabled="!!editing"
          required
          maxlength="128"
        ></label>
        <label>Name<input
          v-model="name"
          required
          maxlength="256"
        ></label>
        <label>{{ challenge ? 'Ranking' : 'Vote ranking' }}<select v-model="rankingId"><option value="">Select a ranking</option><option
          v-for="ranking in eligibleRankings"
          :key="ranking.id"
          :value="ranking.id"
        >{{ ranking.id }}</option></select></label>
        <label>Duration (seconds; 0 is manual)<input
          v-model.number="duration"
          type="number"
          min="0"
          max="86400000"
        ></label>
        <label>Vote limit<input
          v-model.number="voteLimit"
          type="number"
          min="1"
        ></label>
        <label>Minimum participants<input
          v-model.number="minimumParticipants"
          type="number"
          min="1"
          max="100000"
        ></label>
        <label class="check"><input
          v-model="allowSwitch"
          type="checkbox"
        > Allow option switching</label>
        <p v-if="competitionType === 'random_draw' || competitionType === 'weighted_draw'">The draw selects one participant {{ competitionType === 'random_draw' ? 'uniformly' : 'using their committed score' }}. Option winner actions are not used.</p>
        <p v-if="challenge">The ranking leader wins when the competition finishes. With a target, nobody wins unless the leader reached it.</p>
        <label v-if="challenge">Target score (0 for none)<input
          v-model.number="targetScore"
          type="number"
          min="0"
          step="1"
        ></label>
        <label v-if="userWinner">Winning user action (optional)<select v-model="userActionId"><option value="">No action</option><option
          v-for="available in actions"
          :key="available.id"
          :value="available.id"
        >{{ available.name || available.id }}</option></select></label>
        <label v-if="!challenge && competitionType !== 'random_draw' && competitionType !== 'weighted_draw'">Winner selection<select v-model="mode"><option value="highest_score">Highest score</option><option value="uniform_random">Uniform random eligible option</option><option value="weighted_random">Weighted random eligible option</option></select></label>
        <label v-if="competitionType !== 'random_draw' && competitionType !== 'weighted_draw' && (challenge || mode === 'highest_score')">Tie policy<select v-model="tiePolicy"><option value="stable">Stable</option><option value="random">Random</option><option value="manual">Manual</option><option value="no_winner">No winner</option></select></label>
        <template v-if="!challenge">
        <fieldset
          v-for="(option, index) in options"
          :key="index"
        >
          <legend>Option {{ index + 1 }}</legend><label>ID<input
            v-model="option.id"
            required
            maxlength="128"
          ></label><label>Label<input
            v-model="option.label"
            required
            maxlength="256"
          ></label><label>Commands (comma-separated)<input
            v-model="option.command"
            placeholder="!vote"
            maxlength="128"
          ></label><label>Option image URL (optional)<input
            v-model="option.imageUrl"
            maxlength="2048"
            type="url"
          ></label><label>Gift IDs (optional, comma-separated)<input
            v-model="option.giftIds"
            placeholder="123, 456"
          ></label><label>Winner action (optional)<select v-model="option.actionId" @change="option.inputs = []; option.originalAction = null"><option value="">No action</option><option
            v-for="available in actions"
            :key="available.id"
            :value="available.id"
          >{{ available.name || available.id }}</option></select></label>
          <template v-if="option.actionId">
            <div v-for="(input, inputIndex) in option.inputs" :key="inputIndex" class="action-input">
              <label>Input name<input v-model="input.key" maxlength="128"></label>
              <label>Value type<select v-model="input.kind"><option value="string">Text</option><option value="number">Number</option><option value="boolean">True or false</option></select></label>
              <label>Value<input v-if="input.kind !== 'boolean'" v-model="input.value"><select v-else v-model="input.value"><option value="true">True</option><option value="false">False</option></select></label>
              <BaseButton @click="option.inputs.splice(inputIndex, 1)">Remove input</BaseButton>
            </div>
            <BaseButton @click="option.inputs.push({ key: '', value: '', kind: 'string' })">Add action input</BaseButton>
          </template>
          <BaseButton
            v-if="options.length > 1"
            @click="options.splice(index, 1)"
          >
            Remove option
          </BaseButton>
        </fieldset>
        <BaseButton
          :disabled="options.length >= 256"
          @click="options.push(blankOption())"
        >
          Add option
        </BaseButton>
        </template>
        <BaseButton
          type="submit"
          variant="primary"
          :disabled="busy"
        >
          {{ editing ? 'Save competition' : 'Create competition' }}
        </BaseButton>
        <BaseButton v-if="editing" @click="cancelEdit">Cancel edit</BaseButton>
      </form>
    </BasePanel>
    <BasePanel title="Operate competition">
      <div class="form">
        <label>Competition<select v-model="selected"><option value="">Select a competition</option><option
          v-for="item in items"
          :key="item.id"
          :value="item.id"
        >{{ item.name }} ({{ item.id }})</option></select></label>
        <template v-if="selected && state">
          <BaseButton :disabled="busy" @click="copyRevealUrl">Copy winner reveal OBS URL</BaseButton>
          <p>Status: {{ state.lifecycle }} · Generation {{ state.generation }}</p><p v-if="state.deadlineMs">
            Ends: {{ new Date(state.deadlineMs).toLocaleString() }}
          </p><p v-if="state.remainingMs !== null">
            Remaining when paused: {{ Math.ceil(state.remainingMs / 1000) }} seconds
          </p><p v-if="state.lifecycle === 'finalizing'">
            Waiting for an eligible winner or a manual tie decision.
          </p>
          <div class="actions">
            <BaseButton v-if="state.lifecycle === 'draft'" :disabled="busy" @click="editCompetition">Edit competition</BaseButton>
            <BaseButton
              v-if="state.lifecycle === 'draft'"
              :disabled="busy"
              @click="operation('start')"
            >
              Start
            </BaseButton><BaseButton
              v-if="state.lifecycle === 'active'"
              :disabled="busy"
              @click="operation('pause')"
            >
              Pause
            </BaseButton><BaseButton
              v-if="state.lifecycle === 'paused'"
              :disabled="busy"
              @click="operation('resume')"
            >
              Resume
            </BaseButton><BaseButton
              v-if="['active', 'paused', 'finalizing', 'finished'].includes(state.lifecycle)"
              :disabled="busy"
              @click="operation('finish')"
            >
              Finish / retrieve
            </BaseButton><BaseButton
              v-if="['draft', 'active', 'paused'].includes(state.lifecycle)"
              :disabled="busy"
              @click="operation('cancel')"
            >
              Cancel
            </BaseButton><BaseButton @click="detail">
              Refresh
            </BaseButton>
          </div>
          <div
            v-if="candidates.length"
            class="form"
          >
            <label>Tied winner<select v-model="chosenWinner"><option value="">Choose a tied leader</option><option
              v-for="candidate in candidates"
              :key="candidate.key"
              :value="candidate.key"
            >{{ candidate.label || candidate.key }} — {{ candidate.score }}</option></select></label><BaseButton
              :disabled="busy || !chosenWinner"
              @click="selectWinner"
            >
              Select winner
            </BaseButton>
          </div>
          <p
            v-else-if="candidateError"
            class="error"
          >
            {{ candidateError }}
          </p>
          <h3>Winner history</h3><p v-if="!results.length">
            No finalized results.
          </p><ul v-else>
            <li
              v-for="result in results"
              :key="result.generation"
            >
              Generation {{ result.generation }}: {{ result.selection.winner ?? 'No winner' }} ({{ result.selection.mode }})
            </li>
          </ul><p v-if="action">
            Action {{ action.actionId }}: {{ action.status }}<span v-if="action.reason"> ({{ action.reason }})</span>
          </p>
          <div
            v-if="action?.status === 'running'"
            class="actions"
          >
            <p>After the executor has stopped, mark a stranded action uncertain for recovery.</p><BaseButton
              :disabled="busy"
              @click="recoverAction('uncertain')"
            >
              Mark uncertain
            </BaseButton>
          </div>
          <div
            v-if="action?.status === 'uncertain'"
            class="actions"
          >
            <p>Record the observed outcome without executing the action again.</p><BaseButton
              :disabled="busy"
              @click="recoverAction('completed')"
            >
              Mark completed
            </BaseButton><BaseButton
              :disabled="busy"
              @click="recoverAction('failed')"
            >
              Mark failed
            </BaseButton>
          </div>
        </template>
      </div>
    </BasePanel>
  </div>
</template>
<style scoped>
.competition-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: var(--space-4); align-items: start; margin-top: var(--space-4); }
.form { display: grid; gap: var(--space-3); } label { display: grid; gap: var(--space-1); } input:not([type=checkbox]), select { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; color: var(--color-text); background: var(--color-bg-control); border: 1px solid var(--color-border); border-radius: var(--radius-sm); } fieldset { display: grid; gap: var(--space-2); border: 1px solid var(--color-border); } .check, .actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; } .error { color: var(--color-danger, #fb7185); }
</style>
