<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsTotals } from '../../../../shared/messages.ts';
import { formatCount } from '@/shared/lib/intl.ts';

const props = defineProps<{
  totals: AnalyticsTotals;
  sessions: number;
}>();

const { t, locale } = useI18n();

const rows = computed(() =>
  (
    [
      ['peakViewers', props.totals.peakViewers],
      ['sessions', props.sessions],
      ['giftEvents', props.totals.giftEvents],
      ['likeEvents', props.totals.likeEvents],
      ['follows', props.totals.follows],
      ['shares', props.totals.shares],
      ['joins', props.totals.joins],
    ] as const
  ).map(([key, value]) => ({ key, label: t(`analytics.facts.${key}`), value: formatCount(value, locale.value) })),
);
</script>

<template>
  <dl class="session-list">
    <div
      v-for="row in rows"
      :key="row.key"
      class="session-list__row"
    >
      <dt>{{ row.label }}</dt>
      <dd>{{ row.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.session-list {
  margin: 0;
}

.session-list__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-1);
}

.session-list__row + .session-list__row {
  border-top: var(--border-width) solid var(--color-border-subtle);
}

.session-list__row dt {
  color: var(--color-text-muted);
}

.session-list__row dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-semibold);
}
</style>
