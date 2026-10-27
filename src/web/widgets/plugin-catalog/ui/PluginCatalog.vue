<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActionTypeDefinition, PluginStatus } from '../../../../automation/behavior/types.ts';
import { catalogPlugins, pluginState, type PluginCatalogTab } from '@/entities/plugin/lib/plugin-catalog.ts';
import PluginStateBadge from '@/entities/plugin/ui/PluginStateBadge.vue';
import { localizedText } from '@/shared/i18n/i18n.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import IconPuzzle from '@/shared/ui/icon/icons/IconPuzzle.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import BaseList from '@/shared/ui/list/BaseList.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import BaseSegmented from '@/shared/ui/segmented/BaseSegmented.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';

const props = defineProps<{
  plugins: readonly PluginStatus[];
  actionTypes: readonly ActionTypeDefinition[];
}>();

const emit = defineEmits<{ 'install-package': []; open: [id: string] }>();

const tab = defineModel<PluginCatalogTab>('tab', { required: true });
const query = defineModel<string>('query', { default: '' });
const selected = defineModel<string | null>('selected', { default: null });

const { t } = useI18n();

const installedCount = computed(() => props.plugins.filter((plugin) => plugin.installed).length);
const availableCount = computed(() => props.plugins.length - installedCount.value);
const tabs = computed(() => [
  { value: 'installed' as const, label: `${t('plugins.catalog.installed')} (${installedCount.value})` },
  { value: 'available' as const, label: `${t('plugins.catalog.available')} (${availableCount.value})` },
]);
const visible = computed(() => catalogPlugins(props.plugins, tab.value, props.actionTypes, query.value, localizedText));
const filtering = computed(() => query.value.trim().length > 0);
</script>

<template>
  <BasePanel
    class="plugin-catalog"
    :title="t('plugins.title')"
    flush
  >
    <div class="plugin-catalog__body">
      <div class="plugin-catalog__filters">
        <BaseSegmented
          v-model="tab"
          class="plugin-catalog__tabs"
          :options="tabs"
          size="sm"
        />
        <BaseTextField
          v-model="query"
          type="search"
          size="sm"
          :placeholder="t('plugins.catalog.search')"
          :aria-label="t('plugins.catalog.search')"
        >
          <template #prefix>
            <IconSearch />
          </template>
        </BaseTextField>
      </div>
      <BaseList
        v-model:selected="selected"
        class="plugin-catalog__list"
        :items="visible"
        :item-key="(plugin) => plugin.descriptor.id"
        :aria-label="t('plugins.title')"
        @activate="emit('open', $event.descriptor.id)"
      >
        <template #default="{ item }">
          <span
            class="plugin-catalog__item"
            :class="{ 'plugin-catalog__item--off': item.installed && !item.enabled }"
            @pointerdown="emit('open', item.descriptor.id)"
          >
            <IconPuzzle class="plugin-catalog__icon" />
            <span class="plugin-catalog__name">{{ localizedText(item.descriptor.name) }}</span>
            <PluginStateBadge
              v-if="item.installed || !item.available"
              :state="pluginState(item)"
            />
          </span>
        </template>
        <template #empty>
          <BaseEmptyState
            v-if="filtering"
            :title="t('plugins.catalog.noMatches', { query: query.trim() })"
          />
          <BaseEmptyState
            v-else-if="tab === 'installed'"
            :title="t('plugins.catalog.emptyInstalled')"
            :description="t('plugins.catalog.emptyInstalledHint')"
          >
            <template #icon>
              <IconPuzzle :size="28" />
            </template>
            <BaseButton
              v-if="availableCount > 0"
              size="sm"
              @click="tab = 'available'"
            >
              {{ t('plugins.catalog.browseAvailable') }}
            </BaseButton>
          </BaseEmptyState>
          <BaseEmptyState
            v-else
            :title="t('plugins.catalog.emptyAvailable')"
          >
            <BaseButton
              size="sm"
              @click="emit('install-package')"
            >
              {{ t('plugins.install.package') }}
            </BaseButton>
          </BaseEmptyState>
        </template>
      </BaseList>
    </div>
  </BasePanel>
</template>

<style scoped>
.plugin-catalog {
  height: 100%;
}

.plugin-catalog__body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.plugin-catalog__filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border-bottom: var(--border-width) solid var(--color-border-subtle);
}

.plugin-catalog__tabs {
  align-self: stretch;
}

.plugin-catalog__list {
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
}

.plugin-catalog__item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.plugin-catalog__list :deep([aria-selected='true'] .plugin-state) {
  color: inherit;
}

.plugin-catalog__item--off .plugin-catalog__name {
  opacity: 0.6;
}

.plugin-catalog__icon {
  flex: none;
  opacity: 0.75;
}

.plugin-catalog__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

</style>
