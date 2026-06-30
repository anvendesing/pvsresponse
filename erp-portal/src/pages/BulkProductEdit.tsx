import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import {
  ArrowLeft,
  Save,
  Search,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { WarehouseRow } from "@/lib/api";
import type { Product } from "@/data/types";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";

// ── Types ────────────────────────────────────────────────────────────────────

interface RowData {
  id: string;
  sku: string;
  name: string;
  category: string;
  type: string;
  state: string;
  hsn: string;
  gstRate: number | "";
  stockOnHand: number;
}

interface DirtyFields {
  hsn?: string;
  gstRate?: number | "";
  stockQty?: number;
}

type RowStatus = { ok: true; adjRef?: string } | { ok: false; error: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const GST_RATES = [0, 5, 12, 18, 28];

// ── EditableCell ──────────────────────────────────────────────────────────────

function EditableCell({
  value,
  type = "text",
  rowId,
  field,
  dirty,
  onCommit,
  align = "left",
}: {
  value: string | number;
  type?: "text" | "number";
  rowId: string;
  field: keyof DirtyFields;
  dirty: boolean;
  onCommit: (rowId: string, field: keyof DirtyFields, value: string) => void;
  align?: "left" | "right";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    onCommit(rowId, field, draft);
  }, [rowId, field, draft, onCommit]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      setDraft(String(value));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        min={type === "number" ? "0" : undefined}
        step={field === "gstRate" ? "1" : "1"}
        className="w-full px-2 py-1 text-body-sm border border-primary rounded bg-surface outline-none"
        style={{ textAlign: align }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
      />
    );
  }

  return (
    <div
      className={`px-2 py-1 rounded cursor-text text-body-sm hover:bg-primary-soft/40 transition-colors ${
        dirty ? "font-semibold text-primary" : ""
      }`}
      style={{ textAlign: align }}
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value === "" ? <span className="text-ink-muted">—</span> : value}
    </div>
  );
}

// ── GstSelectCell ─────────────────────────────────────────────────────────────

function GstSelectCell({
  value,
  rowId,
  dirty,
  onCommit,
}: {
  value: number | "";
  rowId: string;
  dirty: boolean;
  onCommit: (rowId: string, field: keyof DirtyFields, value: string) => void;
}) {
  return (
    <select
      className={`w-full px-2 py-1 text-body-sm border-0 bg-transparent rounded hover:bg-primary-soft/40 cursor-pointer outline-none focus:ring-1 focus:ring-primary ${
        dirty ? "font-semibold text-primary" : ""
      }`}
      value={value}
      onChange={(e) => onCommit(rowId, "gstRate", e.target.value)}
    >
      <option value="">—</option>
      {GST_RATES.map((r) => (
        <option key={r} value={r}>
          {r}%
        </option>
      ))}
    </select>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export const BulkProductEdit = () => {
  const navigate = useNavigate();

  const productsQuery = useApi(
    () => api.products({ limit: 2000 }),
    []
  );
  const warehousesQuery = useApi(() => api.warehouses(), []);

  const [dirty, setDirty] = useState<Map<string, DirtyFields>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, RowStatus>>(new Map());
  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");

  const warehouses: WarehouseRow[] = (warehousesQuery.data ?? []).filter(
    (w) => w.kind === "storage" && w.active
  );

  // Derive flat row data from loaded products, incorporating dirty overrides
  const rowData = useMemo<RowData[]>(() => {
    if (!productsQuery.data) return [];
    return (productsQuery.data as Product[]).map((p) => {
      const d = dirty.get(p.id);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category?.name ?? "—",
        type: p.type,
        state: p.state,
        hsn: d?.hsn !== undefined ? d.hsn : (p.hsn ?? ""),
        gstRate: d?.gstRate !== undefined ? d.gstRate : (p.gstRate ?? ""),
        stockOnHand: d?.stockQty !== undefined ? d.stockQty : (p.stockOnHand ?? 0),
      };
    });
  }, [productsQuery.data, dirty]);

  const onCommit = useCallback(
    (rowId: string, field: keyof DirtyFields, raw: string) => {
      setStatuses((prev) => { const next = new Map(prev); next.delete(rowId); return next; });
      const product = (productsQuery.data as Product[] | undefined)?.find(
        (p) => p.id === rowId
      );
      if (!product) return;

      setDirty((prev) => {
        const next = new Map(prev);
        const current = next.get(rowId) ?? {};

        if (field === "hsn") {
          const trimmed = raw.trim();
          if (trimmed === (product.hsn ?? "")) {
            const { hsn: _h, ...rest } = current;
            Object.keys(rest).length === 0 ? next.delete(rowId) : next.set(rowId, rest);
          } else {
            next.set(rowId, { ...current, hsn: trimmed });
          }
        }

        if (field === "gstRate") {
          const num = raw === "" ? ("" as const) : Number(raw);
          if (num === (product.gstRate ?? "")) {
            const { gstRate: _g, ...rest } = current;
            Object.keys(rest).length === 0 ? next.delete(rowId) : next.set(rowId, rest);
          } else {
            next.set(rowId, { ...current, gstRate: num });
          }
        }

        if (field === "stockQty") {
          const num = raw === "" ? product.stockOnHand : Math.max(0, Math.round(Number(raw)));
          if (num === (product.stockOnHand ?? 0)) {
            const { stockQty: _s, ...rest } = current;
            Object.keys(rest).length === 0 ? next.delete(rowId) : next.set(rowId, rest);
          } else {
            next.set(rowId, { ...current, stockQty: num });
          }
        }

        return next;
      });
    },
    [productsQuery.data]
  );

  const resetRow = useCallback((rowId: string) => {
    setDirty((prev) => { const next = new Map(prev); next.delete(rowId); return next; });
    setStatuses((prev) => { const next = new Map(prev); next.delete(rowId); return next; });
  }, []);

  const dirtyCount = dirty.size;

  const save = async () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    setGlobalError(null);

    const rows = [...dirty.entries()].map(([productId, fields]) => ({
      productId,
      ...(fields.hsn !== undefined ? { hsn: fields.hsn || null } : {}),
      ...(fields.gstRate !== undefined && fields.gstRate !== "" ? { gstRate: Number(fields.gstRate) } : {}),
      ...(fields.stockQty !== undefined ? { stockQty: fields.stockQty } : {}),
      ...(selectedWarehouseId ? { warehouseId: selectedWarehouseId } : {}),
    }));

    try {
      const { results } = await api.bulkUpdateProducts(rows);
      const newStatuses = new Map<string, RowStatus>();
      const newDirty = new Map(dirty);
      let ok = 0;

      for (const r of results) {
        if (r.ok) {
          newStatuses.set(r.productId, { ok: true, adjRef: r.adjRef });
          newDirty.delete(r.productId);
          ok++;
        } else {
          newStatuses.set(r.productId, { ok: false, error: r.error ?? "error" });
        }
      }

      setStatuses(newStatuses);
      setDirty(newDirty);
      setSavedCount(ok);
      if (ok > 0) await productsQuery.refetch?.();
    } catch (e) {
      setGlobalError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const colHelper = createColumnHelper<RowData>();

  const columns = useMemo(
    () => [
      colHelper.accessor("sku", {
        header: "SKU",
        size: 120,
        enableColumnFilter: false,
        cell: (info) => (
          <span className="font-mono text-caption text-ink-muted">{info.getValue()}</span>
        ),
      }),
      colHelper.accessor("name", {
        header: "Product",
        size: 240,
        cell: (info) => <span className="text-body-sm font-medium">{info.getValue()}</span>,
        filterFn: "includesString",
      }),
      colHelper.accessor("category", {
        header: "Category",
        size: 130,
        enableColumnFilter: false,
        cell: (info) => (
          <span className="text-body-sm text-ink-muted">{info.getValue()}</span>
        ),
      }),
      colHelper.accessor("hsn", {
        header: "HSN Code",
        size: 110,
        enableColumnFilter: false,
        cell: (info) => (
          <EditableCell
            value={info.getValue()}
            type="text"
            rowId={info.row.id}
            field="hsn"
            dirty={!!dirty.get(info.row.id)?.hsn !== undefined && dirty.get(info.row.id)?.hsn !== undefined}
            onCommit={onCommit}
          />
        ),
      }),
      colHelper.accessor("gstRate", {
        header: "GST %",
        size: 90,
        enableColumnFilter: false,
        cell: (info) => (
          <GstSelectCell
            value={info.getValue()}
            rowId={info.row.id}
            dirty={"gstRate" in (dirty.get(info.row.id) ?? {})}
            onCommit={onCommit}
          />
        ),
      }),
      colHelper.accessor("stockOnHand", {
        header: "Stock (qty)",
        size: 110,
        enableColumnFilter: false,
        cell: (info) => (
          <EditableCell
            value={info.getValue()}
            type="number"
            rowId={info.row.id}
            field="stockQty"
            dirty={"stockQty" in (dirty.get(info.row.id) ?? {})}
            onCommit={onCommit}
            align="right"
          />
        ),
      }),
      colHelper.accessor("state", {
        header: "Status",
        size: 90,
        enableColumnFilter: false,
        cell: (info) => {
          const s = info.getValue();
          const tone =
            s === "active" ? "success" :
            s === "discontinued" ? "danger" :
            s === "blocked" ? "warning" : "neutral";
          return (
            <Chip tone={tone} size="sm">
              {s}
            </Chip>
          );
        },
      }),
      colHelper.display({
        id: "_actions",
        header: "",
        size: 60,
        cell: (info) => {
          const rowId = info.row.id;
          const rowDirty = dirty.has(rowId);
          const status = statuses.get(rowId);
          if (status?.ok === true) {
            return (
              <span title={status.adjRef ? `Ref: ${status.adjRef}` : "Saved"}>
                <CheckCircle2 size={16} className="text-success" />
              </span>
            );
          }
          if (status?.ok === false) {
            return (
              <span title={status.error} className="text-danger cursor-help">
                <AlertCircle size={16} />
              </span>
            );
          }
          if (rowDirty) {
            return (
              <button
                className="h-6 w-6 grid place-items-center rounded text-ink-muted hover:text-danger hover:bg-danger-soft"
                title="Discard row changes"
                onClick={() => resetRow(rowId)}
              >
                <RotateCcw size={14} />
              </button>
            );
          }
          return null;
        },
      }),
    ],
    [dirty, statuses, onCommit, resetRow, colHelper]
  );

  const table = useReactTable({
    data: rowData,
    columns,
    getRowId: (row) => row.id,
    state: { columnFilters, globalFilter },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _colId, filterValue: string) => {
      const q = filterValue.toLowerCase();
      return (
        row.original.name.toLowerCase().includes(q) ||
        row.original.sku.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
        <button
          className="h-8 w-8 grid place-items-center rounded hover:bg-canvas text-ink-muted"
          onClick={() => navigate("/products")}
          title="Back to Products"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-heading font-semibold text-ink flex-1">
          Bulk Product Edit
        </h1>
        {dirtyCount > 0 && (
          <span className="text-body-sm text-ink-muted">
            {dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}
          </span>
        )}
        {savedCount > 0 && (
          <span className="flex items-center gap-1 text-body-sm text-success">
            <CheckCircle2 size={14} />
            {savedCount} saved
          </span>
        )}
        <Button
          size="sm"
          icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          disabled={dirtyCount === 0 || saving}
          onClick={save}
        >
          Save {dirtyCount > 0 ? dirtyCount : ""} change{dirtyCount !== 1 ? "s" : ""}
        </Button>
      </div>

      {/* Sub-toolbar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1">
          <Search size={14} className="text-ink-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Filter by name or SKU…"
            className="h-8 flex-1 max-w-xs bg-canvas border border-border rounded px-2 text-body-sm outline-none focus:ring-1 focus:ring-primary"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
          {globalFilter && (
            <button
              className="text-body-sm text-ink-muted hover:text-ink underline"
              onClick={() => setGlobalFilter("")}
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-body-sm text-ink-muted">
          <span>Stock warehouse:</span>
          <select
            className="h-8 border border-border rounded px-2 text-body-sm bg-canvas outline-none focus:ring-1 focus:ring-primary"
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
          >
            <option value="">Auto (put-away rule)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <span className="text-caption text-ink-muted">
          {rows.length} product{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {globalError && (
        <div className="mx-5 mt-3 px-3 py-2 bg-danger-soft border border-danger rounded text-body-sm text-danger flex items-center gap-2">
          <AlertCircle size={14} className="flex-shrink-0" />
          {globalError}
        </div>
      )}

      {/* Usage hint */}
      <div className="px-5 py-2 bg-info-soft border-b border-border text-caption text-ink-muted">
        Click any cell in <strong>HSN Code</strong>, <strong>GST %</strong>, or <strong>Stock</strong> to edit.
        Press <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[10px]">Tab</kbd> or{" "}
        <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[10px]">Enter</kbd> to confirm,{" "}
        <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[10px]">Esc</kbd> to cancel.
        Stock changes create a ledger entry via put-away rules.
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {productsQuery.loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-ink-muted">
            <Loader2 size={20} className="animate-spin" />
            Loading products…
          </div>
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead className="sticky top-0 z-10 bg-surface border-b border-border">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-left text-caption font-semibold text-ink-muted whitespace-nowrap"
                      style={{ width: header.getSize() }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-center text-ink-muted py-12 text-body-sm"
                  >
                    No products match your filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isDirty = dirty.has(row.id);
                  const status = statuses.get(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={[
                        "border-b border-border transition-colors",
                        isDirty
                          ? "bg-primary-soft/20 hover:bg-primary-soft/30"
                          : status?.ok === true
                          ? "bg-success-soft/20"
                          : status?.ok === false
                          ? "bg-danger-soft/20"
                          : "hover:bg-canvas",
                      ].join(" ")}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-1 py-0.5"
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
