import { useState, useRef, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export type Column<T> = {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render?: (row: T, index: number) => ComponentChildren;
  accessor?: (row: T) => string | number;
};

export type PaginationState = {
  page: number; // 1-indexed
  pageSize: number;
  total?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
};

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T | ((row: T) => string);
  stickyHeader?: boolean;
  emptyState?: ComponentChildren;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T, index: number) => string | undefined;
  pagination?: PaginationState;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: string, dir: 'asc' | 'desc') => void;
};

function getKey<T extends Record<string, unknown>>(row: T, idx: number, rowKey: keyof T | ((row: T) => string)): string {
  if (typeof rowKey === 'function') return rowKey(row);
  const v = row[rowKey];
  return v !== undefined ? String(v) : String(idx);
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  stickyHeader = true,
  emptyState,
  loading,
  onRowClick,
  rowClassName,
  pagination,
  sortBy,
  sortDir,
  onSortChange,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="ui-table-wrap">
        <div className="ui-table-skeleton">Loading…</div>
      </div>
    );
  }

  const total = pagination?.total ?? data.length;
  let visibleRows = data;
  let startIndex = 0;
  if (pagination) {
    startIndex = (pagination.page - 1) * pagination.pageSize;
    visibleRows = data.slice(startIndex, startIndex + pagination.pageSize);
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(total / pagination.pageSize)) : 1;
  const showPagination = Boolean(pagination && total > 0);

  // Empty still shows pagination footer for navigating back after filter
  if (visibleRows.length === 0 && total === 0) {
    return (
      <div className="ui-table-wrap">
        <div style={{ padding: 4 }}>{emptyState ?? <div className="ui-empty__title">No data</div>}</div>
        {showPagination ? <PaginationFooter pagination={pagination!} total={total} totalPages={totalPages} /> : null}
      </div>
    );
  }

  return (
    <div className="ui-table-wrap ui-table-with-pagination">
      <table className={`ui-table ${stickyHeader ? 'is-sticky' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => {
              const isSorted = sortBy === c.key;
              const clickable = c.sortable && onSortChange;
              return (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align ?? 'left', cursor: clickable ? 'pointer' : undefined, userSelect: clickable ? 'none' : undefined }}
                  onClick={clickable ? () => onSortChange(c.key, isSorted && sortDir === 'asc' ? 'desc' : 'asc') : undefined}
                  title={clickable ? 'Sort' : undefined}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {c.header}
                    {clickable ? <span style={{ opacity: isSorted ? 1 : 0.3, fontSize: 10 }}>{isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, idx) => {
            const absoluteIdx = startIndex + idx;
            return (
              <tr
                key={getKey(row, absoluteIdx, rowKey)}
                className={rowClassName?.(row, absoluteIdx)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((c) => {
                  const content = c.render ? c.render(row, absoluteIdx) : (c.accessor ? c.accessor(row) : String(row[c.key] ?? ''));
                  return (
                    <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showPagination ? <PaginationFooter pagination={pagination!} total={total} totalPages={totalPages} /> : null}
    </div>
  );
}

function PaginationFooter({ pagination, total, totalPages }: { pagination: PaginationState; total: number; totalPages: number }) {
  const { page, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = [10, 20, 50] } = pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  // clamp page numbers to display (max 5)
  const pages: number[] = [];
  const half = 2;
  let lo = Math.max(1, page - half);
  let hi = Math.min(totalPages, lo + 4);
  lo = Math.max(1, hi - 4);
  for (let i = lo; i <= hi; i++) pages.push(i);

  return (
    <div className="ui-pagination">
      <div className="ui-pagination__info">
        {total > 0 ? `${start}–${end} of ${total}` : '0 results'}
        {onPageSizeChange ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(parseInt((e.target as HTMLSelectElement).value, 10))}
              className="ui-pagination__select"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="ui-pagination__controls">
        <button type="button" className="ui-pagination__btn" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          ‹
        </button>
        {lo > 1 ? (
          <>
            <button type="button" className="ui-pagination__btn" onClick={() => onPageChange(1)}>
              1
            </button>
            {lo > 2 ? <span className="ui-pagination__ellipsis">…</span> : null}
          </>
        ) : null}
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`ui-pagination__btn ${p === page ? 'is-active' : ''}`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}
        {hi < totalPages ? (
          <>
            {hi < totalPages - 1 ? <span className="ui-pagination__ellipsis">…</span> : null}
            <button type="button" className="ui-pagination__btn" onClick={() => onPageChange(totalPages)}>
              {totalPages}
            </button>
          </>
        ) : null}
        <button type="button" className="ui-pagination__btn" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
          ›
        </button>
      </div>
    </div>
  );
}

// Row actions dropdown — “more options” per row
type RowActionsProps = {
  onAdd: () => void;
  onDeduct: () => void;
  onReset: () => void;
  disabled?: boolean;
};

export function RowActions({ onAdd, onDeduct, onReset, disabled }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="ui-row-actions" ref={ref}>
      <button type="button" className="ui-row-actions__trigger" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="More options">
        ⋮
      </button>
      {open ? (
        <div className="ui-row-actions__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onAdd(); }}>
            + Add points
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onDeduct(); }}>
            − Deduct points
          </button>
          <div className="ui-row-actions__divider" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onReset(); }}>
            Reset user
          </button>
        </div>
      ) : null}
    </div>
  );
}
