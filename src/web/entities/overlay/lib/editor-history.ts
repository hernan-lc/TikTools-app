import type { WidgetStyle } from '../../../../widgets/sdk/template.ts';
import { EditorHistory as UniversalEditorHistory } from '../../../../universal/editor.js';

export function cloneDesign(design: WidgetStyle): WidgetStyle {
  return JSON.parse(JSON.stringify(design)) as WidgetStyle;
}

/** Shared bounded command history with the existing snapshot behavior. */
export class EditorHistory<T = WidgetStyle> extends UniversalEditorHistory<T> {}
