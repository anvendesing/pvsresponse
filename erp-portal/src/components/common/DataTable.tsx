import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, idx: number) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  empty?: ReactNode;
  dense?: boolean;
  stickyHeader?: boolean;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  empty,
  dense,
  stickyHeader = true,
  className,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortKey, sortDir, columns]);

  return (
    <div className={cn("relative w-full overflow-auto", className)}>
      <table className="w-full border-collapse">
        <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
          <tr>
            {columns.map((c) => {
              const isSorted = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  className={cn(
                    "grid-header-cell text-left whitespace-nowrap select-none",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.sortable && "cursor-pointer hover:text-primary"
                  )}
                  style={{ width: c.width }}
                  onClick={() => {
                    if (!c.sortable) return;
                    if (sortKey === c.key) {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortKey(c.key);
                      setSortDir("asc");
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {c.sortable && (
                      <span className="text-ink-muted">
                        {!isSorted ? (
                          <ChevronsUpDown size={12} />
                        ) : sortDir === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-ink-muted">
                {empty ?? "No records found."}
              </td>
            </tr>
          )}
          {sorted.map((row, i) => {
            const key = rowKey(row);
            const selected = selectedKey === key;
            return (
              <tr
                key={key}
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer",
                  selected ? "bg-primary-50" : "hover:bg-canvas",
                  dense ? "[&>td]:py-1.5" : ""
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "grid-cell",
                      c.align === "right" && "text-right tnum",
                      c.align === "center" && "text-center",
                      c.className
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
