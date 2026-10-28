<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsSummaryData } from '../../../../shared/messages.ts';
import { hourRowsToSeries, viewersToHourlySeries, type AnalyticsMetric } from '@/entities/analytics/lib/analytics-metrics.ts';
import {
  formatDayDate,
  formatSpan,
  formatZoneShort,
  isSingleDaySpan,
  tzOffsetSecsForDay,
} from '@/entities/analytics/lib/analytics-range.ts';
import AnalyticsDailyChart from '@/entities/analytics/ui/AnalyticsDailyChart.vue';
import AnalyticsHourlyChart from '@/entities/analytics/ui/AnalyticsHourlyChart.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';

const props = defineProps<{
  summary: AnalyticsSummaryData;
  metric: AnalyticsMetric;
}>();

const { t, locale } = useI18n();
const span = computed(() => ({ startDay: props.summary.startDay, endDay: props.summary.endDay }));
const singleDay = computed(() => isSingleDaySpan(span.value));
const approximate = computed(() => singleDay.value && props.summary.hours.length === 0);
const hourly = computed(() =>
  approximate.value
    ? viewersToHourlySeries(props.summary.topViewers, span.value.startDay, tzOffsetSecsForDay(span.value.startDay))
    : hourRowsToSeries(props.summary.hours),
);
const subtitle = computed(() => {
  if (!singleDay.value) return formatSpan(span.value, locale.value);
  const zone = formatZoneShort(locale.value);
  return [formatDayDate(span.value.startDay, locale.value), zone].filter(Boolean).join(' · ');
});
</script>

<template>
  <BasePanel
    :title="singleDay ? t('analytics.activity.today') : t('analytics.activity.title')"
    :subtitle="subtitle"
  >
    <AnalyticsHourlyChart
      v-if="singleDay"
      :series="hourly"
      :metric="metric"
    />
    <AnalyticsDailyChart
      v-else
      :days="summary.days"
      :span="span"
      :metric="metric"
    />
    <p
      v-if="singleDay && approximate"
      class="activity-panel__note"
    >
      {{ t('analytics.activity.approximate') }}
    </p>
  </BasePanel>
</template>

<style scoped>
.activity-panel__note {
  margin: var(--space-3) 0 0;
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
}
</style>
