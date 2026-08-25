import type { JSX } from 'preact';

import { t, type Locale } from '../i18n.ts';
import type { AppTab } from '../types.ts';
import {
  IconBarChart,
  IconChat,
  IconCoins,
  IconRadio,
  IconSettings,
  IconSparkles,
} from './icons.tsx';

type NavigationRailProps = {
  locale: Locale;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function NavigationRail({ locale, activeTab, onTabChange }: NavigationRailProps) {
  const navTabs: Array<{ id: AppTab; tooltip: string; icon: JSX.Element }> = [
    { id: 'feed', tooltip: t(locale, 'tabFeed'), icon: <IconChat /> },
    { id: 'points', tooltip: t(locale, 'tabPoints'), icon: <IconCoins /> },
    { id: 'analytics', tooltip: t(locale, 'tabAnalytics'), icon: <IconBarChart /> },
    { id: 'connect', tooltip: t(locale, 'tabConnect'), icon: <IconRadio /> },
    { id: 'automations', tooltip: t(locale, 'tabPlugins'), icon: <IconSparkles /> },
    { id: 'settings', tooltip: t(locale, 'tabSettings'), icon: <IconSettings /> },
  ];

  return (
    <nav className="nav-rail" aria-label="Main Navigation">
      {navTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
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
