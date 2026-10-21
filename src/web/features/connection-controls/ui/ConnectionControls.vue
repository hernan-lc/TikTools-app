<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { isConnectionBusy } from '@/entities/connection/lib/connection-status.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import type { ConnectionStatus } from '@/types.ts';

defineProps<{
  status: ConnectionStatus;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  reconnect: [];
}>();

const { t } = useI18n();
</script>

<template>
  <span class="connection-controls">
    <template v-if="status === 'connected'">
      <BaseButton
        size="sm"
        @click="emit('reconnect')"
      >
        {{ t('connection.reconnect') }}
      </BaseButton>
      <BaseButton
        size="sm"
        variant="danger"
        @click="emit('disconnect')"
      >
        {{ t('connection.disconnect') }}
      </BaseButton>
    </template>
    <BaseButton
      v-else-if="isConnectionBusy(status)"
      size="sm"
      variant="danger"
      @click="emit('disconnect')"
    >
      {{ t('common.cancel') }}
    </BaseButton>
    <BaseButton
      v-else
      size="sm"
      variant="primary"
      @click="status === 'error' ? emit('reconnect') : emit('connect')"
    >
      {{ status === 'error' ? t('connection.reconnect') : t('connection.connect') }}
    </BaseButton>
  </span>
</template>

<style scoped>
.connection-controls {
  display: inline-flex;
  gap: var(--space-2);
}
</style>
