import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { BehaviorRun } from '../../../automation/behavior/types.ts';
import { t, type Locale } from '../../i18n.ts';
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

/** Right-side cards: derived network allowlist and engine capabilities. */
export function PermissionCards({
  locale,
  network,
  capabilities,
  noneLabel,
}: {
  locale: Locale;
  network: string[];
  capabilities: string[];
  noneLabel: string;
}) {
  return (
    <section aria-label={t(locale, 'behavior.editor.permsTitle')}>
      <div className="act-side-title">{t(locale, 'behavior.editor.permsTitle')}</div>
      <div className="act-cards">
        <div className="act-card">
          <span className="act-card__label">{t(locale, 'behavior.editor.networkCard')}</span>
          {network.length === 0 && <span className="act-card__empty">{noneLabel}</span>}
          {network.map((host) => (
            <span className="act-card__row" key={host}>
              <i className="act-dot is-net" aria-hidden="true" />
              <code>{host}</code>
            </span>
          ))}
        </div>
        <div className="act-card">
          <span className="act-card__label">{t(locale, 'behavior.editor.capsCard')}</span>
          {capabilities.length === 0 && <span className="act-card__empty">{noneLabel}</span>}
          {capabilities.map((capability) => (
            <span className="act-card__row" key={capability}>
              <i className="act-dot is-cap" aria-hidden="true" />
              <code>{capability}</code>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function parseRunStatus(run: BehaviorRun | undefined): { code?: string; ok: boolean; text: string } {
  if (!run) return { ok: true, text: '' };
  const code = /(\d{3})/.exec(`${run.summary} ${run.logs.join(' ')}`)?.[1];
  if (run.status === 'error') return { code, ok: false, text: run.error ?? run.summary };
  return { code, ok: true, text: code ? `${code} OK` : run.summary };
}

/** Right-side test console: run button, status pill and response viewer. */
export function TestConsole({
  locale,
  run,
  headers,
  onRun,
  emptyLabel,
}: {
  locale: Locale;
  run?: BehaviorRun;
  /** Configured request headers shown under the headers tab (fetch only). */
  headers?: Record<string, string>;
  onRun: () => void;
  emptyLabel: string;
}) {
  const [tab, setTab] = useState<'response' | 'headers'>('response');
  const status = parseRunStatus(run);
  const headerEntries = Object.entries(headers ?? {});
  const showTabs = headerEntries.length > 0;

  return (
    <section aria-label={t(locale, 'behavior.editor.consoleTitle')}>
      <div className="act-console-head">
        <span className="act-side-title act-side-title--inline">
          <i className={`act-dot ${run ? (status.ok ? 'is-net' : 'is-err') : ''}`} aria-hidden="true" />
          {t(locale, 'behavior.editor.consoleTitle')}
        </span>
        <button type="button" className="act-runbtn" onClick={onRun}>
          <span className="act-runbtn__icon" aria-hidden="true">▶</span>
          {t(locale, 'behavior.editor.runTest')}
        </button>
      </div>

      {run && (
        <div className="act-status">
          <span className={`act-pill ${status.ok ? 'is-ok' : 'is-err'}`}>{status.text}</span>
          <span className="act-ms">{run.durationMs} ms</span>
        </div>
      )}

      {showTabs && (
        <div className="act-tabs act-tabs--console" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'response'}
            className={`act-tab${tab === 'response' ? ' is-active' : ''}`}
            onClick={() => setTab('response')}
          >
            {t(locale, 'behavior.editor.responseTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'headers'}
            className={`act-tab${tab === 'headers' ? ' is-active' : ''}`}
            onClick={() => setTab('headers')}
          >
            {t(locale, 'behavior.editor.respHeadersTab', { count: headerEntries.length })}
          </button>
        </div>
      )}

      <div className="act-code" role="log" aria-label={t(locale, 'behavior.editor.consoleTitle')}>
        {(!showTabs || tab === 'response') && (
          run && run.logs.length > 0
            ? run.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
            : <span className="act-code__empty">{emptyLabel}</span>
        )}
        {showTabs && tab === 'headers' && headerEntries.map(([key, value]) => (
          <div key={key} className="act-code__kv">
            <span className="act-code__k">{key}:</span> <span className="act-code__v">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Key/value row with per-button tooltips (rename, edit, remove). */
export function KeyValueRowTip({ children }: { children: ComponentChildren }) {
  return <div className="plg-kv-row">{children}</div>;
}
