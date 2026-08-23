import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

type AnchorRef = { current: HTMLElement | null };

type AutocompletePortalProps = {
  anchorRef: AnchorRef;
  open: boolean;
  children: ComponentChildren;
};

/**
 * Renders editor suggestions at document level so modal/canvas overflow never
 * clips the list. It flips above the field when there is not enough room below.
 */
export function AutocompletePortal({ anchorRef, open, children }: AutocompletePortalProps) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });

  useEffect(() => {
    if (!open) return undefined;

    const update = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 12;
      const maxHeight = 260;
      const gap = 6;
      const openAbove = rect.bottom + gap + maxHeight > window.innerHeight && rect.top > maxHeight;
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding));
      const top = openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap;
      setPosition({
        top,
        left,
        width: Math.max(240, Math.min(420, rect.width)),
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, open]);

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
