import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  createSortedRowModel,
  type ColumnDef,
} from '@tanstack/react-table';
import { useRef, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import { RowActions, type RowAction } from './row-actions.tsx';
export interface TableColumn<T> {
  key: string;
  label: string;
  cell: (row: T) => ReactNode;
  sort?: (a: T, b: T) => number;
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

export function DataTable<T extends object>({
  rows,
  columns,
  rowKey,
  empty,
  actions,
  rowTitle,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  actions?: (row: T) => RowAction[];
  /** Named in the phone action sheet, which otherwise has no row context. */
  rowTitle?: (row: T) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const tableColumns: ColumnDef<typeof features, T>[] = columns.map((column) => ({
    id: column.key,
    accessorFn: (row: T) => row,
    enableSorting: Boolean(column.sort),
    sortFn: (a, b) => column.sort?.(a.original, b.original) ?? 0,
  }));

  const table = useTable<typeof features, T>({
    features,
    data: rows,
    getRowId: rowKey,
    enableSortingRemoval: false,
    enableMultiSort: false,
    sortDescFirst: false,
    columns: tableColumns,
  });

  // Measured against the wrapper rather than offsetTop: the table's own box and
  // the scrolling container are not the same origin.
  const place = (row: HTMLElement) => {
    const block = highlight.current;
    const box = wrap.current;
    if (!block || !box) return;
    const rowBox = row.getBoundingClientRect();
    const wrapBox = box.getBoundingClientRect();
    block.style.top = `${rowBox.top - wrapBox.top + box.scrollTop}px`;
    block.style.height = `${rowBox.height}px`;
    block.style.opacity = '1';
  };

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <div
      className="table-wrap"
      ref={wrap}
      onMouseLeave={() => {
        if (highlight.current) highlight.current.style.opacity = '0';
      }}
    >
      <div className="row-highlight" ref={highlight} aria-hidden="true" />
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  table.getColumn(column.key)!.getIsSorted() === 'asc'
                    ? 'ascending'
                    : table.getColumn(column.key)!.getIsSorted() === 'desc'
                      ? 'descending'
                      : undefined
                }
              >
                {column.sort ? (
                  <button
                    type="button"
                    onClick={table.getColumn(column.key)!.getToggleSortingHandler()}
                  >
                    {column.label}
                    {table.getColumn(column.key)!.getIsSorted() === 'asc'
                      ? ' ↑'
                      : table.getColumn(column.key)!.getIsSorted() === 'desc'
                        ? ' ↓'
                        : ''}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
            {actions && (
              <th scope="col" className="cell-actions">
                {t.common.actions}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map(({ original: row }) => (
            <tr
              key={rowKey(row)}
              onMouseEnter={(event) => place(event.currentTarget)}
              onFocus={(event) => place(event.currentTarget)}
            >
              {columns.map((column) => (
                <td key={column.key} data-label={column.label}>
                  {column.cell(row)}
                </td>
              ))}
              {actions && (
                <td className="cell-actions">
                  <RowActions actions={actions(row)} title={rowTitle ? rowTitle(row) : ''} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
