// Dense BOM directory — all recipes in one scrollable snapshot (bulk-edit style).

import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowLeft,
  Copy,
  Layers,
  Network,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api } from "@/lib/api";
import { effectiveUom } from "@/data/types";
import type { Bom, Product, ProductType } from "@/data/types";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { NewBomModal } from "@/components/manufacturing/BomListPanel";

interface Props {
  boms: Bom[];
  products: Product[];
  onCreate: (opts: { productId?: string; variantId?: string | null }) => void;
  onClone: (bom: Bom) => void;
  onChanged: () => void;
}

interface BomRow {
  id: string;
  sku: string;
  product: string;
  variantSku: string;
  variantScope: "default" | "variant";
  revision: string;
  type: string;
  typeLabel: string;
  steps: number;
  components: number;
  released: number;
  outputQty: number;
  outputUom: string;
  active: boolean;
  bom: Bom;
}

const typeLabel: Record<string, string> = {
  finished: "Finished",
  semi: "Semi",
  raw: "Raw",
  consumable: "Consumable",
  service: "Service",
};

const typeTone: Record<string, "primary" | "success" | "warning" | "neutral"> = {
  finished: "success",
  semi: "primary",
  raw: "neutral",
  consumable: "warning",
  service: "neutral",
};

export const BomBrowseTable = ({
  boms,
  products,
  onCreate,
  onClone,
  onChanged,
}: Props) => {
  const navigate = useNavigate();
  const [globalFilter, setGlobalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProductType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [sorting, setSorting] = useState<SortingState>([{ id: "sku", desc: false }]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const bomScopeIndex = useMemo(() => {
    const map = new Map<string, Bom>();
    for (const b of boms) {
      if (!b.productId || !b.active) continue;
      map.set(`${b.productId}::${b.variantId ?? "default"}`, b);
    }
    return map;
  }, [boms]);

  const rowData = useMemo<BomRow[]>(() => {
    return boms.map((b) => {
      const product = b.productId ? productById.get(b.productId) : undefined;
      const v = b.variantId ? product?.variants?.find((x) => x.id === b.variantId) : null;
      const outputUom = v ? effectiveUom(product!, v) : product?.uom ?? "unit";
      return {
        id: b.id,
        sku: b.sku,
        product: b.product,
        variantSku: b.variantSku ?? "—",
        variantScope: b.variantId ? "variant" : "default",
        revision: b.revision,
        type: product?.type ?? "",
        typeLabel: product ? (typeLabel[product.type] ?? product.type) : "—",
        steps: b.operations?.length ?? 0,
        components: b.items.length,
        released: b.byproducts?.length ?? 0,
        outputQty: b.outputQty,
        outputUom,
        active: b.active,
        bom: b,
      };
    });
  }, [boms, productById]);

  const filteredData = useMemo(() => {
    return rowData.filter((r) => {
      if (statusFilter === "active" && !r.active) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      return true;
    });
  }, [rowData, statusFilter, typeFilter]);

  const col = createColumnHelper<BomRow>();

  const onDelete = useCallback(
    async (bom: Bom) => {
      if (
        !confirm(
          `Delete BOM ${bom.revision} for ${bom.sku}? Existing MOs keep their snapshot.`
        )
      )
        return;
      setBusy(bom.id);
      try {
        await api.deleteBom(bom.id);
        onChanged();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );

  const columns = useMemo(
    () => [
      col.accessor("sku", {
        header: "SKU",
        size: 110,
        cell: (info) => (
          <span className="font-mono text-caption font-semibold text-primary">{info.getValue()}</span>
        ),
      }),
      col.accessor("product", {
        header: "Product",
        size: 200,
        cell: (info) => (
          <span className="text-body-sm font-medium truncate block max-w-[220px]" title={info.getValue()}>
            {info.getValue()}
          </span>
        ),
      }),
      col.accessor("variantSku", {
        header: "Variant",
        size: 100,
        cell: (info) =>
          info.row.original.variantScope === "variant" ? (
            <Chip size="sm" tone="primary">
              {info.getValue()}
            </Chip>
          ) : (
            <Chip size="sm" tone="neutral">
              Default
            </Chip>
          ),
      }),
      col.accessor("revision", {
        header: "Rev",
        size: 72,
        cell: (info) => <span className="font-mono text-caption">{info.getValue()}</span>,
      }),
      col.accessor("typeLabel", {
        header: "Type",
        size: 88,
        cell: (info) => (
          <Chip size="sm" tone={typeTone[info.row.original.type] ?? "neutral"}>
            {info.getValue()}
          </Chip>
        ),
      }),
      col.accessor("steps", {
        header: "Steps",
        size: 64,
        cell: (info) => (
          <span className="tnum text-body-sm inline-flex items-center gap-1">
            <Layers size={11} className="text-ink-muted" />
            {info.getValue()}
          </span>
        ),
      }),
      col.accessor("components", {
        header: "In",
        size: 52,
        cell: (info) => <span className="tnum text-body-sm">{info.getValue()}</span>,
      }),
      col.accessor("released", {
        header: "Out",
        size: 52,
        cell: (info) => (
          <span className="tnum text-body-sm text-ink-muted">{info.getValue() || "—"}</span>
        ),
      }),
      col.accessor("outputQty", {
        header: "Batch",
        size: 100,
        cell: (info) => (
          <span className="tnum text-body-sm whitespace-nowrap">
            {num(info.getValue())} {info.row.original.outputUom}
          </span>
        ),
      }),
      col.accessor("active", {
        header: "Status",
        size: 80,
        cell: (info) => (
          <Chip size="sm" tone={info.getValue() ? "success" : "neutral"}>
            {info.getValue() ? "Active" : "Off"}
          </Chip>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        size: 72,
        cell: (info) => {
          const b = info.row.original.bom;
          return (
            <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:text-primary hover:bg-primary/10"
                title="Clone"
                onClick={() => onClone(b)}
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:text-danger hover:bg-danger-soft"
                title="Delete"
                disabled={busy === b.id}
                onClick={() => void onDelete(b)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        },
      }),
    ],
    [busy, col, onClone, onDelete]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _id, filterValue: string) => {
      const q = filterValue.toLowerCase();
      const r = row.original;
      return (
        r.sku.toLowerCase().includes(q) ||
        r.product.toLowerCase().includes(q) ||
        r.revision.toLowerCase().includes(q) ||
        r.variantSku.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const totalActive = boms.filter((b) => b.active).length;

  return (
    <div className="flex flex-col h-full bg-canvas">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface shrink-0">
        <Link
          to="/manufacturing"
          className="h-8 w-8 grid place-items-center rounded hover:bg-canvas text-ink-muted"
          title="Back to Manufacturing"
        >
          <ArrowLeft size={16} />
        </Link>
        <Network size={18} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-heading font-semibold text-ink">Bills of material</h1>
          <p className="text-caption text-ink-muted">
            {totalActive} active · {boms.length} total — click a row to edit
          </p>
        </div>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
          New BOM
        </Button>
      </div>

      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-surface shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="text-ink-muted shrink-0" />
          <input
            type="search"
            placeholder="Filter SKU, product, variant, revision…"
            className="h-8 flex-1 bg-canvas border border-border rounded px-2 text-body-sm outline-none focus:ring-1 focus:ring-primary"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-caption">
          {(["all", "finished", "semi", "raw", "consumable"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-2.5 py-1 border-l border-border first:border-l-0",
                typeFilter === t ? "bg-primary text-white" : "bg-white hover:bg-canvas"
              )}
            >
              {t === "all" ? "All types" : typeLabel[t]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-caption">
          {(["active", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 border-l border-border first:border-l-0",
                statusFilter === s ? "bg-primary text-white" : "bg-white hover:bg-canvas"
              )}
            >
              {s === "active" ? "Active" : "All"}
            </button>
          ))}
        </div>
        <span className="text-caption text-ink-muted ml-auto">
          {rows.length} BOM{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-body-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left text-caption font-semibold text-ink-muted whitespace-nowrap cursor-pointer select-none hover:text-ink"
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{
                      asc: " ↑",
                      desc: " ↓",
                    }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16 text-ink-muted">
                  No BOMs match.{" "}
                  <button type="button" className="text-primary underline" onClick={() => setShowNew(true)}>
                    Create one
                  </button>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => navigate(`/manufacturing/boms/${row.original.id}`)}
                  className={cn(
                    "border-b border-border cursor-pointer transition-colors hover:bg-primary/5",
                    !row.original.active && "opacity-55"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewBomModal
          products={products}
          bomScopeIndex={bomScopeIndex}
          onClose={() => setShowNew(false)}
          onOpenExisting={(b) => {
            setShowNew(false);
            navigate(`/manufacturing/boms/${b.id}`);
          }}
          onConfirm={(productId, variantId) => {
            setShowNew(false);
            onCreate({ productId, variantId });
          }}
        />
      )}
    </div>
  );
};
