# UI Kit — Quick Reference (new `src/web/components/ui/`)

All primitives share the same controlled API + imperative `getValue/setValue` via `ref`. This replaces 5 ad-hoc input styles.

## Installation
Already imported in `src/web/styles.css` via `ui.css`. No new deps.

## Primitives

```tsx
import { FormField, FieldRow } from './components/ui/FormField.tsx';
import { TextInput, SearchInput } from './components/ui/TextInput.tsx';
import { NumberInput } from './components/ui/NumberInput.tsx';
import { Select } from './components/ui/Select.tsx';
import { Checkbox, Switch } from './components/ui/Checkbox.tsx';
import { Card, Badge, Alert, EmptyState, Chip, ChipGroup } from './components/ui/Card.tsx';
import { Button } from './components/ui/Button.tsx';
import { DataTable, type Column } from './components/ui/Table.tsx';
import { Page, PageHeader, SplitLayout, StatCard, StatGrid } from './components/ui/Page.tsx';
```

## Form — same `value/onValueChange` everywhere

```tsx
// Text (prefix @)
const userRef = useRef<TextInputHandle>(null);
<TextInput value={user} onValueChange={setUser} prefix="@" placeholder="handle" error={err} />
userRef.current?.getValue() // "crizthplay"
userRef.current?.setValue("other")
userRef.current?.clear()

// Number with stepper + suffix
<NumberInput value={bonus} onValueChange={setBonus} min={0} max={500} step={5} suffix="%" />

// Select
<Select value={locale} onValueChange={setLocale} options={[{value:'en',label:'English'}]} />

// Checkbox / Switch
<Checkbox checked={enabled} onCheckedChange={setEnabled} label="Puntos por Like" />
<Switch checked={enabled} onCheckedChange={setEnabled} label="Activo" />

// Search (with clear button)
<SearchInput value={q} onValueChange={setQ} placeholder="Buscar…" />

// Wrap with label/hint/error
<FormField label="Usuario del Creador" hint="El @ es opcional" error={fieldError} htmlFor="user">
  <TextInput id="user" value={user} onValueChange={setUser} />
</FormField>

<FieldRow label="Puntos por moneda">
  <NumberInput value={pts} onValueChange={setPts} min={0} step={0.1} />
</FieldRow>
```

## Card / Page

```tsx
<Page narrow>
  <Card title="Conectar a TikTok LIVE" subtitle="..." icon={<IconRadio />}>
    ...
  </Card>
</Page>

<Page>
  <PageHeader title="Analíticas y Métricas" subtitle="..." icon={<IconBarChart/>} meta={<Badge>80 eventos</Badge>} />
  <StatGrid>
    <StatCard icon={<IconChat/>} value={10} label="Chats" tone="cyan" />
  </StatGrid>
  <DataTable ... />
</Page>

<SplitLayout left={<ConfigForm />} right={<LeaderboardTable />} />
```

## Table — one component for leaderboard + analytics ranking

```tsx
const cols: Column<ViewerRecord>[] = [
  { key:'rank', header:'Puesto', width:'48px', render:(_r,i)=> <RankBadge rank={i+1}/> },
  { key:'viewer', header:'Espectador', render:(r)=> <span>@{r.uniqueId}</span> },
  { key:'level', header:'Nivel', width:'72px', align:'center', render:(r)=> <Badge tone="cyan">N.º {r.level}</Badge> },
  { key:'points', header:'Puntos', width:'88px', align:'right', render:(r)=> <span style={{color:'var(--tt-pink)',fontWeight:700}}>{r.points}</span> },
];

<DataTable
  columns={cols}
  data={filtered}
  rowKey="uniqueId"
  stickyHeader
  emptyState={<EmptyState title="Sin datos" description="Conecta a un LIVE..." />}
  rowClassName={(_,i)=> i<3 ? `top-rank-${i+1}` : undefined}
/>
```

## Button

```tsx
<Button variant="primary" block>Conectar al LIVE</Button>
<Button variant="soft" size="sm">+ Cookie</Button>
<Button variant="cyan" icon={<IconDice/>} iconOnly tooltip="Pick Random LIVE" />
<Button variant="danger" icon={<IconTrash/>} />
```

## Migration Checklist
- [ ] Replace `connect-card`/`tikfinity-card`/`stats-card-large` → `<Card>`
- [ ] Replace `input[type=text]`/`tikfinity-number-input`/`feed-search-wrap` → `TextInput`/`NumberInput`/`SearchInput` + `FormField`
- [ ] Replace `tikfinity-toggle-row` → `<FieldRow><Checkbox/><NumberInput/></FieldRow>`
- [ ] Replace `tikfinity-table` + analytics flex list → `<DataTable>`
- [ ] Replace `.error-banner`/`.recent-chip`/inline styles → `<Alert>`/`<Chip>`/`<Badge>`
- [ ] Wrap each view in `<Page>` (`narrow` for Connect/Settings)

See [Development Guide](DEVELOPMENT.md) for frontend conventions, current view ownership, and the validation checklist.
