<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(defineProps<{
  message: string;
  tone?: 'error' | 'warning' | 'info' | 'ok';
  actionLabel?: string;
}>(), { tone: 'info', actionLabel: undefined });

defineEmits<{ action: []; dismiss: [] }>();
const { t } = useI18n();
</script>

<template>
  <div
    class="base-notification"
    :class="`base-notification--${tone}`"
  >
    <div
      :role="tone === 'error' ? 'alert' : 'status'"
      class="base-notification__content"
    >
      <button
        v-if="actionLabel"
        type="button"
        class="base-notification__action"
        @click="$emit('action')"
      >
        <span>{{ message }}</span>
        <span class="base-notification__hint">{{ actionLabel }} →</span>
      </button>
      <span v-else>{{ message }}</span>
    </div>
    <button
      type="button"
      class="base-notification__dismiss"
      :aria-label="t('common.close')"
      @click="$emit('dismiss')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.base-notification {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: var(--border-width) solid var(--color-border);
  background: var(--color-bg-app);
  color: var(--color-text);
  box-shadow: var(--shadow-popup);
}
.base-notification--error { border-color: var(--color-danger); }
.base-notification--warning { border-color: var(--color-warning); }
.base-notification--ok { border-color: var(--color-success); }
.base-notification__content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.base-notification__action, .base-notification__dismiss {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.base-notification__action { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; text-align: left; }
.base-notification__hint { text-decoration: underline; }
.base-notification__dismiss { font-size: 1.25em; line-height: 1; }
</style>
