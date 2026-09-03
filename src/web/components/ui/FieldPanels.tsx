import type { ComponentChildren } from 'preact';
import { InfoTip } from './InfoTip.tsx';

/** Collapsible group for advanced fields, with a count badge + tooltip. */
export function AdvancedSection({
  title,
  hint,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: ComponentChildren;
  defaultOpen?: boolean;
}) {
  return (
    <details className="plg-details" open={defaultOpen || undefined}>
      <summary>
        <span>{title}</span>
        {typeof count === 'number' && count > 0 ? <span className="plg-details__count">{count}</span> : null}
        {hint ? (
          <span className="plg-details__tip" onClick={(event) => event.preventDefault()}>
            <InfoTip text={hint} position="right" />
          </span>
        ) : null}
      </summary>
      <div className="plg-details__body">{children}</div>
    </details>
  );
}

/** Right-side card: what the engine derived from the current draft. */
export function PermissionsPanel({
  title,
  hint,
  network,
  capabilities,
  noneLabel,
  networkHint,
  capabilitiesHint,
}: {
  title: string;
  hint: string;
  network: string[];
  capabilities: string[];
  noneLabel: string;
  networkHint: string;
  capabilitiesHint: string;
}) {
  return (
    <div className="plg-panel">
      <div className="plg-panel__head">
        <span className="plg-section-title">{title}</span>
        <InfoTip text={hint} position="left" />
      </div>
      <div className="plg-kv" data-tooltip={networkHint} data-tooltip-pos="left" data-tooltip-wide="">
        <span className="plg-kv__key">network</span>
        <span className="plg-kv__value">{network.join(', ') || noneLabel}</span>
      </div>
      <div className="plg-kv" data-tooltip={capabilitiesHint} data-tooltip-pos="left" data-tooltip-wide="">
        <span className="plg-kv__key">capabilities</span>
        <span className="plg-kv__value">{capabilities.join(', ') || noneLabel}</span>
      </div>
    </div>
  );
}

/** Right-side card: last test output. */
export function ConsolePanel({
  title,
  hint,
  lines,
  emptyLabel,
}: {
  title: string;
  hint: string;
  lines: string[];
  emptyLabel: string;
}) {
  const visible = lines.length > 0 ? lines : [emptyLabel];
  return (
    <div className="plg-panel">
      <div className="plg-panel__head">
        <span className="plg-section-title">{title}</span>
        <InfoTip text={hint} position="left" />
      </div>
      <div className="plg-console" role="log" aria-label={title}>
        {visible.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

/** Key/value row with per-button tooltips (rename, edit, remove). */
export function KeyValueRowTip({ children }: { children: ComponentChildren }) {
  return <div className="plg-kv-row">{children}</div>;
}
