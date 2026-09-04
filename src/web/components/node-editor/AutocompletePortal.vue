<script lang="tsx">
import type { VNodeChild } from 'vue';
import { onMounted, onUnmounted, ref, Teleport, watch, type Ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';

type AnchorRef = Ref<HTMLElement | null>;
type CursorRef = Ref<HTMLInputElement | HTMLTextAreaElement | null>;

type AutocompletePortalProps = {
  anchorRef: AnchorRef;
  cursorRef?: CursorRef;
  cursorOffset?: number;
  open: boolean;
  children: VNodeChild;
};

/**
 * Renders editor suggestions at document level so modal/canvas overflow never
 * clips the list. It flips above the field when there is not enough room below.
 */
export const AutocompletePortal = defineVueComponent<AutocompletePortalProps>(
  ['anchorRef', 'cursorRef', 'cursorOffset', 'open'],
  (props) => {
  const position = ref({ top: 0, left: 0, width: 320 });

  const update = (): void => {
      if (!props.open) return;
      const anchor = props.anchorRef.value;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const cursorRect = props.cursorRef && props.cursorOffset !== undefined
        ? measureCursor(props.cursorRef.value, props.cursorOffset)
        : undefined;
      const topAnchor = cursorRect?.top ?? anchorRect.top;
      const bottomAnchor = cursorRect?.bottom ?? anchorRect.bottom;
      const leftAnchor = cursorRect?.left ?? anchorRect.left;
      const viewportPadding = 12;
      const maxHeight = 260;
      const gap = 6;
      const width = Math.max(240, Math.min(420, anchorRect.width));
      const openAbove = bottomAnchor + gap + maxHeight > window.innerHeight && topAnchor > maxHeight;
      const left = Math.max(viewportPadding, Math.min(leftAnchor, window.innerWidth - width - viewportPadding));
      const top = openAbove ? Math.max(viewportPadding, topAnchor - maxHeight - gap) : bottomAnchor + gap;
      position.value = {
        top,
        left,
        width,
      };
  };

  onMounted(() => {
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
  });
  onUnmounted(() => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
  });
  watch(() => [props.open, props.cursorOffset, props.anchorRef.value, props.cursorRef?.value], update, { flush: 'post' });

  return () => {
    if (!props.open || typeof document === 'undefined' || !document.body) return null;
    return (
      <Teleport to="body">
        <div
          class="node-editor-autocomplete-portal"
          style={{ top: `${position.value.top}px`, left: `${position.value.left}px`, width: `${position.value.width}px` }}
        >
          {props.children}
        </div>
      </Teleport>
    );
  };
  },
);

function measureCursor(element: HTMLInputElement | HTMLTextAreaElement | null, offset: number): { left: number; top: number; bottom: number } | undefined {
  if (!element || typeof document === 'undefined' || !document.body) return undefined;

  const elementRect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const copyProperties = [
    'boxSizing',
    'font',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'padding',
    'border',
    'tabSize',
    'textIndent',
    'textTransform',
    'wordBreak',
  ] as const;

  mirror.style.position = 'fixed';
  mirror.style.left = `${elementRect.left}px`;
  mirror.style.top = `${elementRect.top}px`;
  mirror.style.width = `${elementRect.width}px`;
  mirror.style.height = `${elementRect.height}px`;
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
  mirror.style.overflowWrap = element instanceof HTMLTextAreaElement ? 'break-word' : 'normal';
  for (const property of copyProperties) mirror.style[property] = styles[property];

  const safeOffset = Math.max(0, Math.min(offset, element.value.length));
  mirror.textContent = element.value.slice(0, safeOffset);
  marker.textContent = '\u200b';
  marker.style.display = 'inline-block';
  marker.style.width = '1px';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const left = elementRect.left + markerRect.left - mirrorRect.left - element.scrollLeft;
  const top = elementRect.top + markerRect.top - mirrorRect.top - element.scrollTop;
  const bottom = top + Math.max(markerRect.height, parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) || 16);
  mirror.remove();
  return { left, top, bottom };
}

export default AutocompletePortal;
</script>
