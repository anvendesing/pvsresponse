// Side-panel that lists every BOM in the system grouped by parent
// product type, with quick actions to edit or create. Opened from
// the Manufacturing page toolbar via "Manage BOMs".

import { useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  Network,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import type { Bom, Product } from "@/data/types";
import { cn } from "@/lib/cn";

interface Props {
  boms: Bom[];
  products: Product[];
  onClose: () => void;
  onEdit: (bom: Bom) => void;
  onCreate: (seedProductId?: string) => void;
  // Clone bumps the revision in place (same scope) and opens the
  // clone in the editor for further changes. The full multi-target
  // clone UX lives inside the editor.
  onClone: (bom: Bom) => void;
  onChanged: () => void;
}

const groupTitle: Record<string, string> = {
  finished: "Finished goods",
  semi: "Sub-assemblies (semi)",
  raw: "Raw with a BOM",
  consumable: "Consumables with a BOM",
  service: "Services",
};

interface GroupRow {
  key: string;
  title: string;
  subtitle?: string;
  boms: Bom[];
  productId?: string;
}

type GroupMode = "product" | "type";

export const BomListPanel = ({
  boms,
  products,
  onClose,
  onEdit,
  onCreate,
  onClone,
  onChanged,
}: Props) => {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Default to product grouping - the portfolio of BOMs grows
  // very quickly once variants and revisions land, and engineers
  // typically maintain by product family rather than by type.
  const [groupMode, setGroupMode] = useState<GroupMode>("product");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Visible BOMs after the free-text filter is applied.
  const visible = useMemo(() => {
    const filter = q.trim().toLowerCase();
    return boms.filter((b) =>
      filter
        ? b.sku.toLowerCase().includes(filter) ||
          b.product.toLowerCase().includes(filter) ||
          b.revision.toLowerCase().includes(filter) ||
          (b.variantSku?.toLowerCase().includes(filter) ?? false) ||
          (b.variantLabel?.toLowerCase().includes(filter) ?? false)
        : true
    );
  }, [boms, q]);

  // Build groups based on the selected mode.
  // - "product": one group per parent product, BOMs sorted with
  //   default first then variants by SKU. This is the default
  //   maintenance view since variants of the same product share
  //   most of the recipe.
  // - "type": one group per product type (Finished, Semi, etc.),
  //   useful when looking across the catalog.
  const grouped = useMemo(() => {
    if (groupMode === "type") {
      const groups = new Map<string, Bom[]>();
      for (const b of visible) {
        const product = products.find((p) => p.id === b.productId);
        const t = product?.type ?? "unknown";
        const list = groups.get(t) ?? [];
        list.push(b);
        groups.set(t, list);
      }
      return Array.from(groups.entries())
        .map(([key, list]): GroupRow => ({
          key,
          title: groupTitle[key] ?? key,
          subtitle: undefined,
          boms: list,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    }
    // Group by product.
    const groups = new Map<string, Bom[]>();
    for (const b of visible) {
      if (!b.productId) continue;
      const list = groups.get(b.productId) ?? [];
      list.push(b);
      groups.set(b.productId, list);
    }
    return Array.from(groups.entries())
      .map(([productId, list]): GroupRow => {
        const sample = list[0];
        const product = products.find((p) => p.id === productId);
        const sortedList = [...list].sort((a, b) => {
          if (!a.variantId && b.variantId) return -1;
          if (a.variantId && !b.variantId) return 1;
          if (a.variantSku && b.variantSku)
            return a.variantSku.localeCompare(b.variantSku);
          return a.revision.localeCompare(b.revision);
        });
        return {
          key: productId,
          title: `${sample?.sku ?? "?"} · ${sample?.product ?? "?"}`,
          subtitle: product
            ? `${product.type} · ${product.uom}${
                product.variants?.length
                  ? ` · ${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}`
                  : ""
              }`
            : undefined,
          boms: sortedList,
          productId,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [visible, products, groupMode]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(grouped.map((g) => g.key)));

  const onDelete = async (bom: Bom) => {
    if (
      !confirm(
        `Delete BOM ${bom.revision} for ${bom.sku}? Existing MOs keep their snapshot, but no new MO can use it.`
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
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-end"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-2xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Network size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Bills of material
              </div>
              <div className="text-body-sm">
                {boms.length} BOM{boms.length === 1 ? "" : "s"} across the catalog. Multi-level
                supported via parent-child product links.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-canvas">
          <div className="flex-1">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search by SKU, product, variant or revision…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => onCreate()}
          >
            New BOM
          </Button>
        </div>

        {/* Group-by toolbar - lets the user pivot between
            product-centric and type-centric views, plus collapse
            controls for navigating large catalogs quickly. */}
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 text-body-sm bg-surface">
          <span className="text-caption text-ink-muted uppercase font-semibold">
            Group by
          </span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => {
                setGroupMode("product");
                setCollapsed(new Set());
              }}
              className={cn(
                "px-2.5 py-1 text-body-sm transition-colors",
                groupMode === "product"
                  ? "bg-primary text-white"
                  : "bg-white text-ink hover:bg-canvas"
              )}
            >
              Product
            </button>
            <button
              onClick={() => {
                setGroupMode("type");
                setCollapsed(new Set());
              }}
              className={cn(
                "px-2.5 py-1 text-body-sm transition-colors border-l border-border",
                groupMode === "type"
                  ? "bg-primary text-white"
                  : "bg-white text-ink hover:bg-canvas"
              )}
            >
              Type
            </button>
          </div>
          <div className="flex-1" />
          <button
            onClick={expandAll}
            className="text-caption text-primary underline px-1.5"
          >
            expand all
          </button>
          <button
            onClick={collapseAll}
            className="text-caption text-primary underline px-1.5"
          >
            collapse all
          </button>
          <span className="text-caption text-ink-muted">
            {visible.length} BOM{visible.length === 1 ? "" : "s"} ·{" "}
            {grouped.length} group{grouped.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {grouped.length === 0 ? (
            <div className="p-8 text-center text-body-sm text-ink-muted">
              No BOMs match.
            </div>
          ) : (
            grouped.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key} className="mb-0.5">
                  <div className="px-3 py-2 bg-canvas/60 sticky top-0 z-10 border-b border-border flex items-center gap-2">
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-canvas text-ink-muted shrink-0"
                      title={isCollapsed ? "Expand" : "Collapse"}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-body-sm font-semibold truncate">
                        {group.title}
                      </div>
                      {group.subtitle && (
                        <div className="text-caption text-ink-muted truncate">
                          {group.subtitle}
                        </div>
                      )}
                    </button>
                    <Chip size="sm" tone="neutral">
                      {group.boms.length} BOM{group.boms.length === 1 ? "" : "s"}
                    </Chip>
                    {groupMode === "product" && group.productId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreate(group.productId);
                        }}
                        className="text-caption text-primary underline inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-primary-50 rounded shrink-0"
                        title="Add another BOM (new variant or revision) for this product"
                      >
                        <Plus size={11} /> add
                      </button>
                    )}
                  </div>
                  {!isCollapsed &&
                    group.boms.map((b) => {
                      const subCount = b.items.filter((i) => i.hasSubAssembly)
                        .length;
                      const isVariantBom = !!b.variantId;
                      return (
                        <button
                          key={b.id}
                          onClick={() => onEdit(b)}
                          className={cn(
                            "w-full text-left px-4 py-2.5 border-b border-border/50 hover:bg-canvas",
                            !b.active && "opacity-60"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* When grouping by product the SKU is
                                    redundant in the row; drop it for
                                    cleaner scanning. */}
                                {groupMode === "type" && (
                                  <span className="font-mono text-caption text-primary font-semibold">
                                    {b.sku}
                                  </span>
                                )}
                                <Chip size="sm" tone="neutral">
                                  {b.revision}
                                </Chip>
                                {isVariantBom ? (
                                  <Chip
                                    size="sm"
                                    tone="primary"
                                    icon={<Package size={10} />}
                                  >
                                    {b.variantLabel ??
                                      b.variantSku ??
                                      "variant"}
                                  </Chip>
                                ) : (
                                  <Chip size="sm" tone="neutral">
                                    default
                                  </Chip>
                                )}
                                {!b.active && (
                                  <Chip size="sm" tone="danger">
                                    inactive
                                  </Chip>
                                )}
                              </div>
                              {groupMode === "type" && (
                                <div className="text-body-sm font-semibold truncate">
                                  {b.product}
                                </div>
                              )}
                              <div className="text-caption text-ink-muted mt-0.5 flex items-center gap-3 flex-wrap">
                                <span>
                                  <Boxes size={10} className="inline" />{" "}
                                  {b.items.length} component
                                  {b.items.length === 1 ? "" : "s"}
                                </span>
                                {subCount > 0 && (
                                  <span className="text-primary">
                                    <Layers size={10} className="inline" />{" "}
                                    {subCount} sub-assembl
                                    {subCount === 1 ? "y" : "ies"}
                                  </span>
                                )}
                                <span>batch of {b.outputQty}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onClone(b);
                                }}
                                disabled={busy === b.id}
                                className="text-caption text-primary underline px-2 py-1 hover:bg-primary-50 rounded inline-flex items-center gap-1"
                                title="Clone this BOM (revision bump or to another variant)"
                              >
                                <Copy size={11} /> clone
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onDelete(b);
                                }}
                                disabled={busy === b.id}
                                className="text-caption text-danger underline px-2 py-1 hover:bg-danger-soft rounded"
                              >
                                {busy === b.id ? "…" : "delete"}
                              </button>
                              <ChevronRight
                                size={14}
                                className="text-ink-muted"
                              />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
