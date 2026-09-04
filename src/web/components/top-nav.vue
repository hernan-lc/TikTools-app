<script setup lang="ts">
import { t, type Locale } from '../i18n.ts';
import type { Theme } from '../preferences.ts';
import type { ConnectionStatus } from '../types.ts';
import { AppIcon } from './app-icon.vue';
import {
  IconGlobe,
  IconMoon,
  IconPower,
  IconRefresh,
  IconSun,
} from './icons.vue';

type TopNavProps = {
  locale: Locale;
  theme: Theme;
  status: ConnectionStatus;
  activeCreator: string;
  onThemeToggle: () => void;
  onLocaleToggle: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
};

const props = defineProps<TopNavProps>();
</script>

<template>
  <header class="top-nav">
    <div class="brand-section">
      <div class="brand-logo" data-tooltip="TikTok LIVE" data-tooltip-pos="bottom">
        <AppIcon :size="28" />
      </div>
      <div class="brand-info">
        <h1>
          TikTok LIVE
          <span :class="['badge-live', props.status === 'connected' ? 'live' : props.status === 'connecting' || props.status === 'retrying' ? 'busy' : 'offline']">
            {{ props.status === 'connected' ? t(props.locale, 'live') : props.status === 'connecting' || props.status === 'retrying' ? t(props.locale, 'connecting') : t(props.locale, 'disconnected') }}
          </span>
        </h1>
      </div>
    </div>

    <div class="top-center">
      <div v-if="props.activeCreator" class="active-creator-pill" :data-tooltip="`Status: ${props.status}`" data-tooltip-pos="bottom">
        <span :class="['status-dot', props.status === 'connected' ? 'online' : props.status === 'connecting' || props.status === 'retrying' ? 'busy' : 'offline']" />
        <span>@{{ props.activeCreator.replace(/^@/, '') }}</span>
      </div>
    </div>

    <div class="top-actions">
      <template v-if="props.status === 'connected'">
        <button
          class="btn-icon"
          type="button"
          :data-tooltip="t(props.locale, 'reconnect')"
          data-tooltip-pos="bottom"
          @click="props.onReconnect"
        >
          <IconRefresh />
        </button>
        <button
          class="btn-icon btn-danger"
          type="button"
          :data-tooltip="t(props.locale, 'disconnect')"
          data-tooltip-pos="bottom"
          @click="props.onDisconnect"
        >
          <IconPower />
        </button>
      </template>

      <button
        class="btn-icon"
        type="button"
        :data-tooltip="t(props.locale, 'switchTheme')"
        data-tooltip-pos="bottom"
        @click="props.onThemeToggle"
      >
        <IconSun v-if="props.theme === 'dark'" />
        <IconMoon v-else />
      </button>

      <button
        class="btn-icon"
        type="button"
        :data-tooltip="`${t(props.locale, 'switchLanguage')} (${props.locale.toUpperCase()})`"
        data-tooltip-pos="bottom"
        @click="props.onLocaleToggle"
      >
        <IconGlobe />
      </button>
    </div>
  </header>
</template>
