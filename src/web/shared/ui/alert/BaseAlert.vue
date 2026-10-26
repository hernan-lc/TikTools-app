<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    tone?: 'error' | 'warning' | 'info' | 'ok';
    title: string;
    compact?: boolean;
  }>(),
  { tone: 'error', compact: false },
);

const role = computed(() => (props.tone === 'error' ? 'alert' : 'status'));
</script>

<template>
  <div
    class="base-alert"
    :class="[`base-alert--${tone}`, { 'base-alert--compact': compact }]"
    :role="role"
  >
    <p class="base-alert__title">
      {{ title }}
    </p>
    <div
      v-if="$slots.default"
      class="base-alert__body"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.base-alert {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
}

.base-alert__title {
  margin: 0;
  font-weight: var(--font-weight-semibold);
}

.base-alert__body {
  margin-top: var(--space-2);
  font-weight: var(--font-weight-regular);
}

.base-alert--error {
  border-color: var(--color-danger);
  color: var(--color-danger-hover);
}

.base-alert--warning {
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.base-alert--ok {
  border-color: var(--color-success);
  color: var(--color-success);
}

.base-alert--info {
  color: var(--color-text-muted);
}

.base-alert--compact {
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-sm);
}

.base-alert--compact .base-alert__title {
  font-weight: var(--font-weight-regular);
}

.base-alert--compact .base-alert__body {
  margin-top: var(--space-1);
}
</style>
