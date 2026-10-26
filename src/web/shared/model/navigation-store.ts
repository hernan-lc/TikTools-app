import { defineStore } from 'pinia';
import { ref } from 'vue';
import { loadViewState, saveViewState } from '@/shared/lib/view-state.ts';
import type { AppTab } from '@/types.ts';

export const useNavigationStore = defineStore('navigation', () => {
  const activeTab = ref<AppTab>((loadViewState().tab as AppTab | undefined) ?? 'feed');
  const sidebarCollapsed = ref(loadViewState().sidebar?.collapsed ?? false);

  function open(tab: AppTab): void {
    if (activeTab.value === tab) return;
    activeTab.value = tab;
    saveViewState('tab', tab);
  }

  function setSidebarCollapsed(collapsed: boolean): void {
    if (sidebarCollapsed.value === collapsed) return;
    sidebarCollapsed.value = collapsed;
    saveViewState('sidebar', { collapsed });
  }

  function toggleSidebar(): void {
    setSidebarCollapsed(!sidebarCollapsed.value);
  }

  return { activeTab, open, sidebarCollapsed, setSidebarCollapsed, toggleSidebar };
});
