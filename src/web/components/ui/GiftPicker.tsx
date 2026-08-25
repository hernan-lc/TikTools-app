import type { GiftCatalogEntry, ViewerRecord } from '../../../shared/messages.ts';
import type { Locale } from '../../i18n.ts';
import { FieldIconGlyph } from '../condition-icons.tsx';
import { PickerModal } from './PickerModal.tsx';

const GIFT_COPY = {
  es: {
    title: 'Elegir regalo',
    description: 'Los regalos del directo, con su precio en diamantes.',
    search: 'Buscar regalo',
    empty: 'No hay regalos guardados todavía: conéctate una vez a un directo y se rellena solo.',
    manual: 'Escribir el nombre a mano',
    manualPlaceholder: 'Rosa',
    done: 'Listo',
    close: 'Cancelar',
    already: 'Ese regalo ya está en la lista: se usa el de arriba.',
  },
  en: {
    title: 'Pick a gift',
    description: "The live's gifts, with their diamond price.",
    search: 'Search gift',
    empty: 'No gifts stored yet: connect to a live once and this fills in by itself.',
    manual: 'Type the name by hand',
    manualPlaceholder: 'Rose',
    done: 'Done',
    close: 'Cancel',
    already: 'That gift is already in the list: the one above is used.',
  },
} as const;

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
  const copy = GIFT_COPY[locale];
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
  es: {
    title: 'Elegir usuario',
    description: 'Quien ya ha pasado por tus directos, ordenado por puntos.',
    search: 'Buscar por @ o nombre',
    empty: 'Todavía no hay usuarios conocidos. Escribe el @ a mano.',
    manual: 'Escribir un @ a mano',
    manualPlaceholder: 'luna_dev',
    done: 'Listo',
    close: 'Cancelar',
    already: 'Ese usuario ya está en la lista: se usa el de arriba.',
    points: (points: number) => `${Math.round(points)} pts`,
  },
  en: {
    title: 'Pick a viewer',
    description: 'People already seen in your lives, ordered by points.',
    search: 'Search by @ or name',
    empty: 'No known viewers yet. Type the @ by hand.',
    manual: 'Type an @ by hand',
    manualPlaceholder: 'luna_dev',
    done: 'Done',
    close: 'Cancel',
    already: 'That viewer is already in the list: the one above is used.',
    points: (points: number) => `${Math.round(points)} pts`,
  },
} as const;

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
  const copy = USER_COPY[locale];
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
