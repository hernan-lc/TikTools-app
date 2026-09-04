<script lang="tsx">
import type { GiftCatalogEntry, ViewerRecord } from '../../../shared/messages.ts';
import { i18nText, t, type Locale } from '../../i18n.ts';
import { FieldIconGlyph } from '../condition-icons.vue';
import { PickerModal } from './PickerModal.vue';

const GIFT_COPY = {
  title: { default: "Pick a gift", i18key: "picker.gift.title" },
  description: { default: "The live's gifts, with their diamond price.", i18key: "picker.gift.description" },
  search: { default: "Search gift", i18key: "picker.gift.search" },
  empty: { default: "No gifts stored yet: connect to a live once and this fills in by itself.", i18key: "picker.gift.empty" },
  manual: { default: "Type the name by hand", i18key: "picker.gift.manual" },
  manualPlaceholder: { default: "Rose", i18key: "picker.gift.manualPlaceholder" },
  done: { default: "Done", i18key: "picker.gift.done" },
  close: { default: "Cancel", i18key: "picker.gift.close" },
  already: { default: "That gift is already in the list: the one above is used.", i18key: "picker.gift.already" },
} as const;

function giftCopyFor(locale: Locale) {
  const copy = {} as Record<keyof typeof GIFT_COPY, string>;
  for (const [key, value] of Object.entries(GIFT_COPY)) copy[key as keyof typeof GIFT_COPY] = i18nText(locale, value);
  return copy;
}

type GiftPickerProps = {
  locale: Locale;
  gifts: GiftCatalogEntry[];
  selected: string[];
  multiple?: boolean;
  onPick: (values: string[]) => void;
  onClose: () => void;
};

/** Gifts are stored by NAME, because that is what the event carries. */
export function GiftPicker({ locale, gifts, selected, multiple, onPick, onClose }: GiftPickerProps) {
  const copy = giftCopyFor(locale);
  const seen = new Set<string>();
  const options = gifts
    .filter((gift) => {
      if (seen.has(gift.name)) return false;
      seen.add(gift.name);
      return true;
    })
    .map((gift) => ({
      value: gift.name,
      label: gift.name,
      meta: (
        <>
          <FieldIconGlyph icon="gem" size={11} />
          {gift.diamondCount}
        </>
      ),
      imageUrl: gift.iconUrl,
      keywords: gift.id,
      fallback: <FieldIconGlyph icon="gift" size={18} />,
    }));

  return (
    <PickerModal
      title={copy.title}
      description={copy.description}
      options={options}
      selected={selected}
      multiple={multiple}
      searchPlaceholder={copy.search}
      emptyLabel={copy.empty}
      manualLabel={copy.manual}
      manualPlaceholder={copy.manualPlaceholder}
      alreadyLabel={copy.already}
      doneLabel={copy.done}
      closeLabel={copy.close}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

const USER_COPY = {
  title: { default: "Pick a viewer", i18key: "picker.user.title" },
  description: { default: "People already seen in your lives, ordered by points.", i18key: "picker.user.description" },
  search: { default: "Search by @ or name", i18key: "picker.user.search" },
  empty: { default: "No known viewers yet. Type the @ by hand.", i18key: "picker.user.empty" },
  manual: { default: "Type an @ by hand", i18key: "picker.user.manual" },
  manualPlaceholder: { default: "luna_dev", i18key: "picker.user.manualPlaceholder" },
  done: { default: "Done", i18key: "picker.user.done" },
  close: { default: "Cancel", i18key: "picker.user.close" },
  already: { default: "That viewer is already in the list: the one above is used.", i18key: "picker.user.already" },
  points: { default: "{points} pts", i18key: "picker.user.points" },
} as const;

function userCopyFor(locale: Locale) {
  const copy = {} as Record<keyof typeof USER_COPY, string>;
  for (const [key, value] of Object.entries(USER_COPY)) copy[key as keyof typeof USER_COPY] = i18nText(locale, value);
  return { ...copy, points: (points: number) => t(locale, 'picker.user.points', { points: Math.round(points) }) };
}

type UserPickerProps = {
  locale: Locale;
  viewers: ViewerRecord[];
  selected: string[];
  multiple?: boolean;
  onPick: (values: string[]) => void;
  onClose: () => void;
};

/** Known viewers come from the points table — the only list the app owns. */
export function UserPicker({ locale, viewers, selected, multiple, onPick, onClose }: UserPickerProps) {
  const copy = userCopyFor(locale);
  const options = viewers.map((viewer) => ({
    value: viewer.uniqueId,
    label: `@${viewer.uniqueId}`,
    meta: [viewer.nickname, copy.points(viewer.points)].filter(Boolean).join(' · '),
    imageUrl: viewer.avatarUrl,
    keywords: viewer.nickname ?? '',
    fallback: <FieldIconGlyph icon="user" size={18} />,
  }));

  return (
    <PickerModal
      title={copy.title}
      description={copy.description}
      options={options}
      selected={selected}
      multiple={multiple}
      searchPlaceholder={copy.search}
      emptyLabel={copy.empty}
      manualLabel={copy.manual}
      manualPlaceholder={copy.manualPlaceholder}
      alreadyLabel={copy.already}
      doneLabel={copy.done}
      closeLabel={copy.close}
      onPick={(values) => onPick(values.map((value) => value.replace(/^@/, '').trim()).filter(Boolean))}
      onClose={onClose}
    />
  );
}

export default GiftPicker;
</script>
