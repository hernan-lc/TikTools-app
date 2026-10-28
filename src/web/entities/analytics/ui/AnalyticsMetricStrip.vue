<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsTotals } from '../../../../shared/messages.ts';
import { useRovingSelection } from '@/shared/lib/use-roving-selection.ts';
import { formatCount } from '@/shared/lib/intl.ts';
import { analyticsMetrics, metricColor, totalFor, type AnalyticsMetric } from '../lib/analytics-metrics.ts';
import IconChat from '@/shared/ui/icon/icons/IconChat.vue';
import IconCoins from '@/shared/ui/icon/icons/IconCoins.vue';
import IconDiamond from '@/shared/ui/icon/icons/IconDiamond.vue';
import IconEye from '@/shared/ui/icon/icons/IconEye.vue';
import IconHeart from '@/shared/ui/icon/icons/IconHeart.vue';

const props = defineProps<{
  totals: AnalyticsTotals;
}>();

const model = defineModel<AnalyticsMetric>({ required: true });
const { t, locale } = useI18n();

const icons: Record<AnalyticsMetric, unknown> = {
  chats: IconChat,
  gifts: IconCoins,
  likes: IconHeart,
  diamonds: IconDiamond,
  peakViewers: IconEye,
};

const items = computed(() =>
  analyticsMetrics.map((metric) => ({
    metric,
    label: t(`analytics.metrics.${metric}`),
    value: formatCount(totalFor(props.totals, metric), locale.value),
  })),
);
const selectedIndex = computed(() => analyticsMetrics.indexOf(model.value));
const { focusIndex, select, onKeydown, setElement } = useRovingSelection(items, selectedIndex, (index) => {
  model.value = analyticsMetrics[index]!;
});
</script>

<template>
  <div
    class="kpi-strip"
    role="radiogroup"
    :aria-label="t('analytics.metricPicker')"
    @keydown="onKeydown"
  >
    <button
      v-for="(item, index) in items"
      :key="item.metric"
      :ref="(element) => setElement(index, element)"
      class="kpi-strip__card"
      type="button"
      role="radio"
      :aria-checked="index === selectedIndex"
      :tabindex="index === focusIndex ? 0 : -1"
      :style="{ '--metric-color': metricColor[item.metric] }"
      @click="select(index)"
    >
      <span class="kpi-strip__icon">
        <component
          :is="icons[item.metric]"
          :size="15"
        />
      </span>
      <span class="kpi-strip__label">{{ item.label }}</span>
      <span class="kpi-strip__value">{{ item.value }}</span>
    </button>
  </div>
</template>

<style scoped>
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-4);
}

.kpi-strip__card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: var(--space-3);
  align-items: center;
  min-width: 0;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-panel);
  color: var(--color-text);
  font-family: var(--font-family);
  text-align: left;
  cursor: pointer;
  outline: none;
}

.kpi-strip__card:hover {
  border-color: var(--color-border-strong);
}

.kpi-strip__card[aria-checked='true'] {
  border-color: var(--metric-color);
}

.kpi-strip__card:focus-visible {
  box-shadow: var(--focus-ring);
}

.kpi-strip__icon {
  display: inline-flex;
  grid-row: span 2;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--metric-color) 16%, transparent);
  color: var(--metric-color);
}

.kpi-strip__label {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kpi-strip__value {
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: var(--line-height-tight);
}

@media (width < 1100px) {
  .kpi-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width < 720px) {
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .kpi-strip__card {
    padding: var(--space-4);
  }

  .kpi-strip__value {
    font-size: 18px;
  }
}
</style>
