import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

type AnchorRef = { current: HTMLElement | null };
type CursorRef = { current: HTMLInputElement | HTMLTextAreaElement | null };

type AutocompletePortalProps = {
  anchorRef: AnchorRef;
  cursorRef?: CursorRef;
  cursorOffset?: number;
  open: boolean;
  children: ComponentChildren;
};

/**
 * Renders editor suggestions at document level so modal/canvas overflow never
 * clips the list. It flips above the field when there is not enough room below.
 */
export function AutocompletePortal({ anchorRef, cursorRef, cursorOffset, open, children }: AutocompletePortalProps) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });

  useEffect(() => {
    if (!open) return undefined;

    const update = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const cursorRect = cursorRef && cursorOffset !== undefined
        ? measureCursor(cursorRef.current, cursorOffset)
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
      setPosition({
        top,
        left,
        width,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, cursorRef, cursorOffset, open]);

  if (!open || typeof document === 'undefined' || !document.body) return null;
  return createPortal(
    <div
      className="node-editor-autocomplete-portal"
      style={{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }}
    >
      {children}
    </div>,
    document.body,
  );
}

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
