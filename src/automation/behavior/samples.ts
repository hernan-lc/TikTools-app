import type { AutomationEvent, AutomationEventType, JsonObject } from '../types.ts';
import { sampleDataForType, sampleEventForType } from '../event-registry.ts';

/** Sample event used by the WebView editor and client-side validation tests. */
export function sampleEventFor(type: AutomationEventType): AutomationEvent {
  return sampleEventForType(type);
}

/** Sample event data used by script field suggestions. */
export function sampleDataFor(type: AutomationEventType): JsonObject {
  return sampleDataForType(type);
}
