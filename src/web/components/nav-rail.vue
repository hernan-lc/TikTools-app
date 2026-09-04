<script lang="tsx">
import type { VNode } from 'vue';

import { t, type Locale } from '../i18n.ts';
import type { AppTab } from '../types.ts';
import {
  IconBarChart,
  IconChat,
  IconCoins,
  IconRadio,
  IconSettings,
  IconSparkles,
  IconPlugins,
} from './icons.vue';

type NavigationRailProps = {
  locale: Locale;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function NavigationRail({ locale, activeTab, onTabChange }: NavigationRailProps) {
  const navTabs: Array<{ id: AppTab; tooltip: string; icon: VNode }> = [
    { id: 'feed', tooltip: t(locale, 'tabFeed'), icon: <IconChat /> },
    { id: 'points', tooltip: t(locale, 'tabPoints'), icon: <IconCoins /> },
    { id: 'analytics', tooltip: t(locale, 'tabAnalytics'), icon: <IconBarChart /> },
    { id: 'connect', tooltip: t(locale, 'tabConnect'), icon: <IconRadio /> },
    { id: 'behavior', tooltip: t(locale, 'tabBehavior'), icon: <IconSparkles /> },
    { id: 'plugins', tooltip: t(locale, 'tabPlugins'), icon: <IconPlugins /> },
    { id: 'settings', tooltip: t(locale, 'tabSettings'), icon: <IconSettings /> },
  ];

  return (
    <nav class="nav-rail" aria-label="Main Navigation">
      {navTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          class={`nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          data-tooltip={tab.tooltip}
          data-tooltip-pos="right"
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon}
        </button>
      ))}
    </nav>
  );
}

export default NavigationRail;
</script>
