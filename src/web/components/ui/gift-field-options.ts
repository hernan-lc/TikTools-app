import type { JsonObject } from '../../../automation/types.ts';
import type { GiftCatalogEntry } from '../../../shared/messages.ts';
import type { FieldOption } from './schema-form-helpers.ts';

/**
 * True when a schema UI hint requests the shared gift picker: either the
 * explicit `picker: 'gift'` marker or the `kind: 'gift'` shorthand. Any
 * other value (including a mistyped picker name) is ignored, so unknown
 * hints always degrade to the default renderer for the field.
 */
export function isGiftPickerHint(hint: JsonObject | undefined): boolean {
  if (!hint) return false;
  return hint.picker === 'gift' || hint.kind === 'gift';
}

/**
 * Maps dynamic `host.gifts` options back to catalog entries for the shared
 * `GiftPicker`. Names are the identity (what event filters store); the
 * option `meta` carries the gift id, diamond price, and icon URL the
 * picker rows display. Entries without a usable name are skipped and
 * duplicates collapse first-wins, mirroring the Rust mapper and the
 * event picker. Missing metadata degrades to a plain named row with the
 * fallback glyph — the picker always stays usable.
 */
export function giftCatalogEntriesFromOptions(
  options: readonly FieldOption[] | undefined,
): GiftCatalogEntry[] {
  if (!options) return [];
  const seen = new Set<string>();
  const entries: GiftCatalogEntry[] = [];
  for (const option of options) {
    if (!option || typeof option.value !== 'string') continue;
    const name = option.value.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const meta = option.meta;
    const giftId = typeof meta?.giftId === 'string' && meta.giftId ? meta.giftId : name;
    const diamonds = typeof meta?.diamondCount === 'number' && Number.isFinite(meta.diamondCount)
      ? Math.max(0, Math.floor(meta.diamondCount))
      : 0;
    const entry: GiftCatalogEntry = { id: giftId, name, diamondCount: diamonds };
    if (typeof meta?.iconUrl === 'string' && meta.iconUrl) entry.iconUrl = meta.iconUrl;
    entries.push(entry);
  }
  return entries;
}
