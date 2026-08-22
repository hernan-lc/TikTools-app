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

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T | ((row: T) => string);
  stickyHeader?: boolean;
  emptyState?: ComponentChildren;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T, index: number) => string | undefined;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  stickyHeader = true,
  emptyState,
  loading,
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const getKey = (row: T, idx: number): string => {
    if (typeof rowKey === 'function') return rowKey(row);
    const v = row[rowKey];
    return v !== undefined ? String(v) : String(idx);
  };

  if (loading) {
    return (
      <div className="ui-table-wrap">
        <div className="ui-table-skeleton">Loading…</div>
      </div>
    );
  }

  if (data.length === 0) {
    return <div className="ui-table-wrap">{emptyState ?? <div className="ui-empty__title">No data</div>}</div>;
  }

  return (
    <div className="ui-table-wrap">
      <table className={`ui-table ${stickyHeader ? 'is-sticky' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={getKey(row, idx)}
              className={rowClassName?.(row, idx)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => {
                const content = c.render ? c.render(row, idx) : (c.accessor ? c.accessor(row) : String(row[c.key] ?? ''));
                return (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
