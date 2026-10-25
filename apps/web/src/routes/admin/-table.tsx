import {
  tableFeatures,
  rowSortingFeature,
  createSortedRowModel,
  sortFns,
  useTable,
} from '@tanstack/react-table';
import type { ColumnDef, RowData } from '@tanstack/react-table';
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
export type Column<T extends RowData> = ColumnDef<typeof features, T>;
export function DataTable<T extends RowData>({
  data,
  columns,
}: {
  data: T[];
  columns: Column<T>[];
}) {
  const table = useTable({ features, data, columns });
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id}>
                {header.column.getCanSort() ? (
                  <button onClick={header.column.getToggleSortingHandler()}>
                    <table.FlexRender header={header} />
                    {header.column.getIsSorted() === 'asc'
                      ? ' ↑'
                      : header.column.getIsSorted() === 'desc'
                        ? ' ↓'
                        : ''}
                  </button>
                ) : (
                  <table.FlexRender header={header} />
                )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
