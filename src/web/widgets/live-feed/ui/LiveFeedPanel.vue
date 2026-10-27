<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { eventFilters, filterEvents, windowEvents } from '@/entities/live-event/lib/event-filter.ts';
import { useLiveFeedStore } from '@/entities/live-event/model/live-feed-store.ts';
import EventRow from '@/entities/live-event/ui/EventRow.vue';
import type { ViewerIdentity } from '@/entities/viewer/lib/viewer-profile.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import IconChat from '@/shared/ui/icon/icons/IconChat.vue';
import IconChevronDown from '@/shared/ui/icon/icons/IconChevronDown.vue';
import IconPause from '@/shared/ui/icon/icons/IconPause.vue';
import IconPlay from '@/shared/ui/icon/icons/IconPlay.vue';
import IconPopout from '@/shared/ui/icon/icons/IconPopout.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import IconTrash from '@/shared/ui/icon/icons/IconTrash.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import BaseSegmented from '@/shared/ui/segmented/BaseSegmented.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import { vTooltip } from '@/shared/ui/tooltip/v-tooltip.ts';
import type { DisplayEvent, EventFilter } from '@/types.ts';

defineProps<{
  selectedEventId: number | null;
  inspectorOpen: boolean;
}>();

const emit = defineEmits<{
  select: [event: DisplayEvent];
  'open-viewer': [viewer: ViewerIdentity];
  'toggle-inspector': [];
}>();

const { t } = useI18n();
const store = useLiveFeedStore();
const { events, filter, searchQuery, autoScroll, unreadCount, droppedUiEvents, renderLimit, imagesEnabled } = storeToRefs(store);

const filterOptions = computed(() => eventFilters.map((value) => ({ value, label: t(`feed.filters.${value}`) })));
const activeFilter = computed<EventFilter>({ get: () => filter.value, set: (value) => store.setFilter(value) });
const query = computed({ get: () => searchQuery.value, set: (value: string) => store.setSearchQuery(value) });

const filtered = computed(() => filterEvents(events.value, filter.value, searchQuery.value));
const rendered = computed(() =>
  windowEvents(filtered.value, {
    autoScroll: autoScroll.value,
    filter: filter.value,
    query: searchQuery.value,
    limit: renderLimit.value,
  }),
);
</script>

<template>
  <BasePanel
    class="live-feed"
    :title="t('feed.title')"
    flush
  >
    <template #actions>
      <BaseSegmented
        v-model="activeFilter"
        class="live-feed__filters"
        size="sm"
        :options="filterOptions"
        :aria-label="t('feed.filterLabel')"
      />
      <div class="live-feed__controls">
        <BaseTextField
          v-model="query"
          class="live-feed__search"
          type="search"
          size="sm"
          :placeholder="t('feed.search')"
          :aria-label="t('feed.search')"
        >
          <template #prefix>
            <IconSearch />
          </template>
        </BaseTextField>
        <BaseIconButton
          :label="autoScroll ? t('feed.pause') : t('feed.resume')"
          size="sm"
          :pressed="autoScroll"
          @click="store.handleToggleAutoScroll()"
        >
          <IconPause v-if="autoScroll" />
          <IconPlay v-else />
        </BaseIconButton>
        <BaseIconButton
          :label="t('feed.clear')"
          size="sm"
          @click="store.resetEvents()"
        >
          <IconTrash />
        </BaseIconButton>
        <BaseIconButton
          :label="inspectorOpen ? t('feed.inspector.hide') : t('feed.inspector.show')"
          size="sm"
          :pressed="inspectorOpen"
          @click="emit('toggle-inspector')"
        >
          <IconPopout />
        </BaseIconButton>
      </div>
    </template>

    <div
      :ref="(element) => store.setStreamContainerRef(element as Element | null)"
      class="live-feed__stream"
      role="log"
      :aria-label="t('feed.title')"
    >
      <BaseEmptyState
        v-if="!filtered.length"
        :title="t('feed.empty')"
      >
        <template #icon>
          <IconChat :size="28" />
        </template>
      </BaseEmptyState>
      <div
        v-else
        role="list"
      >
        <EventRow
          v-for="event in rendered.visible"
          :key="event.id"
          :event="event"
          :images="imagesEnabled"
          :selected="event.id === selectedEventId"
          @select="emit('select', $event)"
          @open-viewer="emit('open-viewer', $event)"
        />
      </div>
    </div>

    <div
      v-if="!autoScroll && unreadCount > 0"
      class="live-feed__jump"
    >
      <BaseButton
        variant="primary"
        size="sm"
        @click="store.handleToggleAutoScroll()"
      >
        <template #icon>
          <IconChevronDown />
        </template>
        {{ t('feed.jump', { count: unreadCount }) }}
      </BaseButton>
    </div>

    <template #footer>
      <span class="live-feed__count">{{ t('feed.count', { count: filtered.length }, filtered.length) }}</span>
      <span
        v-if="rendered.windowed"
        v-tooltip="t('feed.windowedHint')"
        class="live-feed__hint"
      >{{ t('feed.windowed', { count: rendered.visible.length }) }}</span>
      <span
        v-if="droppedUiEvents > 0"
        class="live-feed__hint live-feed__hint--warning"
      >{{ t('feed.dropped', { count: droppedUiEvents }) }}</span>
    </template>
  </BasePanel>
</template>

<style scoped>
.live-feed {
  position: relative;
}

.live-feed__search {
  flex: 1;
  min-width: 0;
}

:deep(.base-panel__header) {
  flex-wrap: wrap;
  row-gap: var(--space-2);
}

:deep(.base-panel__actions) {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  margin-left: 0;
}

.live-feed__filters {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.live-feed__controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.live-feed__stream {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.live-feed__jump {
  position: absolute;
  bottom: 44px;
  left: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-popup);
}

.live-feed__count {
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.live-feed__hint {
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
}

.live-feed__hint--warning {
  color: var(--color-warning);
}

@media (width < 900px) {
  .live-feed__stream {
    min-height: 0;
  }

}
</style>
