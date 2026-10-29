import type { RouteLocationNormalizedLoaded, RouteLocationRaw, RouteLocationResolved } from 'vue-router';
import { parsePluginNavId, pluginNavId } from '../../../automation/plugins/declarative.ts';
import type { AppTab, BuiltinAppTab } from '@/types.ts';

declare module 'vue-router' {
  interface RouteMeta {
    tab?: BuiltinAppTab;
  }
}

export const builtinTabPaths: Record<BuiltinAppTab, string> = {
  feed: '/feed',
  points: '/points',
  analytics: '/analytics',
  connect: '/connections',
  behavior: '/automations',
  plugins: '/plugins',
  widgets: '/overlays',
  rankings: '/rankings',
  settings: '/settings',
};

export const pluginPageRouteName = 'plugin-page';

function isBuiltinTab(tab: string): tab is BuiltinAppTab {
  return Object.hasOwn(builtinTabPaths, tab);
}

export function tabLocation(tab: AppTab): RouteLocationRaw {
  const plugin = parsePluginNavId(tab);
  if (plugin) return { name: pluginPageRouteName, params: plugin };
  return isBuiltinTab(tab) ? builtinTabPaths[tab] : builtinTabPaths.feed;
}

type TabRoute = Pick<RouteLocationNormalizedLoaded | RouteLocationResolved, 'name' | 'params' | 'meta'>;

export function tabFromRoute(route: TabRoute): AppTab | null {
  if (route.name === pluginPageRouteName) {
    const { pluginId, pageId } = route.params;
    if (typeof pluginId === 'string' && typeof pageId === 'string') return pluginNavId(pluginId, pageId);
    return null;
  }
  return route.meta.tab ?? null;
}
