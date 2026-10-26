import { onBeforeUnmount, readonly, ref, type Ref } from 'vue';

/**
 * Reactive wrapper around `window.matchMedia`.
 *
 * Returns `false` (never matches) when `matchMedia` is unavailable, such as
 * in tests or server rendering, so callers can use it unconditionally.
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return readonly(matches);
  }
  const list = window.matchMedia(query);
  matches.value = list.matches;
  const onChange = (event: { matches: boolean }): void => {
    matches.value = event.matches;
  };
  if (typeof list.addEventListener === 'function') list.addEventListener('change', onChange);
  else list.addListener(onChange);
  onBeforeUnmount(() => {
    if (typeof list.removeEventListener === 'function') list.removeEventListener('change', onChange);
    else list.removeListener(onChange);
  });
  return readonly(matches);
}
