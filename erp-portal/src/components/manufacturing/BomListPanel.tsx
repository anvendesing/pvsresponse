// Clean table-based BOM directory. Lists every BOM in a single
// sortable/filterable table; creating a new BOM is a two-step
// modal that asks for parent product and variant before opening
// the full editor seeded with both. Used as a full page at
// /manufacturing/boms or historically as a drawer overlay.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpDown,
  Boxes,
  Check,
  ChevronRight,
  Copy,
  Layers,
  Network,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { effectiveUom } from "@/data/types";
import type { Bom, Product, ProductType, ProductVariant } from "@/data/types";
import { cn } from "@/lib/cn";

interface Props {
  boms: Bom[];
  products: Product[];
  /** Full-page route vs legacy drawer overlay. */
  variant?: "page" | "drawer";
  onClose: () => void;
  onEdit: (bom: Bom) => void;
  // Caller decides where to route. variantId may be null for product-level
  // default scope, or a variant id for variant-scoped BOM.
  onCreate: (opts: { productId?: string; variantId?: string | null }) => void;
  onClone: (bom: Bom) => void;
  onChanged: () => void;
}

type SortKey = "product" | "variant" | "revision" | "type" | "items" | "output" | "status";
type SortDir = "asc" | "desc";

const typeLabel: Record<string, string> = {
  finished: "Finished",
  semi: "Semi",
  raw: "Raw",
  consumable: "Consumable",
  service: "Service",
};

const typeTone: Record<
  string,
  "primary" | "success" | "warning" | "neutral" | "danger"
> = {
  finished: "success",
  semi: "primary",
  raw: "neutral",
  consumable: "warning",
  service: "neutral",
};

const variantDescriptor = (v: ProductVariant): string => {
  const bits = [v.size, v.color, v.grade].filter(
    (b): b is string => !!b && b.trim().length > 0
  );
  return bits.join(" · ");
};

export const BomListPanel = ({
  boms,
  products,
  variant = "drawer",
  onClose,
  onEdit,
  onCreate,
  onClone,
  onChanged,
}: Props) => {
  const isPage = variant === "page";
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProductType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("product");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showNew, setShowNew] = useState(false);

  // Build a quick index of (productId+variantId) -> active BOM, used
  // by the create modal to flag scopes that already have a BOM.
  const bomScopeIndex = useMemo(() => {
    const map = new Map<string, Bom>();
    for (const b of boms) {
      if (!b.productId || !b.active) continue;
      map.set(`${b.productId}::${b.variantId ?? "default"}`, b);
    }
    return map;
  }, [boms]);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const filter = q.trim().toLowerCase();
    return boms.filter((b) => {
      if (statusFilter === "active" && !b.active) return false;
      if (typeFilter !== "all") {
        const p = b.productId ? productById.get(b.productId) : undefined;
        if (!p || p.type !== typeFilter) return false;
      }
      if (!filter) return true;
      return (
        b.sku.toLowerCase().includes(filter) ||
        b.product.toLowerCase().includes(filter) ||
        b.revision.toLowerCase().includes(filter) ||
        (b.variantSku?.toLowerCase().includes(filter) ?? false) ||
        (b.variantLabel?.toLowerCase().includes(filter) ?? false)
      );
    });
  }, [boms, q, typeFilter, statusFilter, productById]);

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const list = [...filtered];
    list.sort((a, b) => {
      const ap = a.productId ? productById.get(a.productId) : undefined;
      const bp = b.productId ? productById.get(b.productId) : undefined;
      let cmp = 0;
      switch (sortKey) {
        case "product":
          cmp = a.product.localeCompare(b.product) || a.sku.localeCompare(b.sku);
          if (cmp === 0) {
            // Default scope before variants, then variant SKU order.
            if (!a.variantId && b.variantId) cmp = -1;
            else if (a.variantId && !b.variantId) cmp = 1;
            else cmp = (a.variantSku ?? "").localeCompare(b.variantSku ?? "");
          }
          break;
        case "variant":
          cmp =
            (a.variantSku ?? "—").localeCompare(b.variantSku ?? "—") ||
            a.product.localeCompare(b.product);
          break;
        case "revision":
          cmp = a.revision.localeCompare(b.revision, undefined, {
            numeric: true,
          });
          break;
        case "type":
          cmp = (ap?.type ?? "").localeCompare(bp?.type ?? "");
          break;
        case "items":
          cmp = a.items.length - b.items.length;
          break;
        case "output":
          cmp = a.outputQty - b.outputQty;
          break;
        case "status":
          cmp = Number(a.active) - Number(b.active);
          break;
      }
      return cmp * factor;
    });
    return list;
  }, [filtered, sortKey, sortDir, productById]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

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

  const totalActive = boms.filter((b) => b.active).length;

  const panel = (
    <div
      className={cn(
        "bg-surface overflow-hidden flex flex-col",
        isPage ? "h-full min-h-0 w-full" : "w-full max-w-5xl h-full elevation-3"
      )}
    >
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isPage && (
            <Link
              to="/manufacturing"
              className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas shrink-0"
              title="Back to Manufacturing"
            >
              <ArrowLeft size={18} />
            </Link>
          )}
          <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md shrink-0">
            <Network size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Bills of material
            </div>
            <div className="text-body-sm truncate">
              {totalActive} active · {boms.length} total. Multi-level supported via
              parent-child product links.
            </div>
          </div>
        </div>
        {!isPage && (
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas shrink-0"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-canvas flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <Input
            size="sm"
            iconLeft={<Search size={14} />}
            placeholder="Search by SKU, product, variant or revision…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-body-sm">
          {(["all", "finished", "semi", "raw", "consumable"] as const).map(
            (t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "px-2.5 py-1 transition-colors border-l border-border first:border-l-0",
                  typeFilter === t
                    ? "bg-primary text-white"
                    : "bg-white text-ink hover:bg-canvas"
                )}
              >
                {t === "all" ? "All types" : typeLabel[t] ?? t}
              </button>
            )
          )}
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-body-sm">
          {(["active", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 transition-colors border-l border-border first:border-l-0",
                statusFilter === s
                  ? "bg-primary text-white"
                  : "bg-white text-ink hover:bg-canvas"
              )}
            >
              {s === "active" ? "Active only" : "All status"}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowNew(true)}
        >
          New BOM
        </Button>
      </div>

      <div className="px-4 py-1.5 border-b border-border text-caption text-ink-muted bg-surface">
        Showing {sorted.length} of {boms.length} BOM
        {boms.length === 1 ? "" : "s"}
      </div>

      <div className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="p-12 text-center text-body-sm text-ink-muted">
            No BOMs match. Try clearing filters or{" "}
            <button
              onClick={() => setShowNew(true)}
              className="text-primary underline"
            >
              create a new one
            </button>
            .
          </div>
        ) : (
          <table className="w-full text-body-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-canvas sticky top-0 z-10">
                <Th
                  sortKey="product"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  Product
                </Th>
                <Th
                  sortKey="variant"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  Variant
                </Th>
                <Th
                  sortKey="revision"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  Revision
                </Th>
                <Th
                  sortKey="type"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  Type
                </Th>
                <Th
                  sortKey="items"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="right"
                >
                  Items
                </Th>
                <Th
                  sortKey="output"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="right"
                >
                  Batch
                </Th>
                <Th
                  sortKey="status"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                >
                  Status
                </Th>
                <th className="px-3 py-2 text-right text-caption font-semibold text-ink-muted border-b border-border whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const product = b.productId
                  ? productById.get(b.productId)
                  : undefined;
                const subCount = b.items.filter((i) => i.hasSubAssembly).length;
                const isVariantBom = !!b.variantId;
                const v = product?.variants?.find((x) => x.id === b.variantId);
                const outputUom = v
                  ? effectiveUom(product!, v)
                  : product?.uom ?? "unit";
                return (
                  <tr
                    key={b.id}
                    onClick={() => onEdit(b)}
                    className={cn(
                      "cursor-pointer hover:bg-primary-50/40 transition-colors",
                      !b.active && "opacity-60"
                    )}
                  >
                    <td className="px-3 py-2.5 border-b border-border/50 align-top">
                      <div className="font-mono text-caption text-primary font-semibold">
                        {b.sku}
                      </div>
                      <div className="text-ink truncate max-w-[26rem]" title={b.product}>
                        {b.product}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top">
                      {isVariantBom ? (
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <Chip
                            size="sm"
                            tone="primary"
                            icon={<Package size={10} />}
                          >
                            {b.variantSku ?? "variant"}
                          </Chip>
                          {b.variantLabel && b.variantLabel !== b.variantSku && (
                            <span className="text-caption text-ink-muted truncate max-w-[18rem]">
                              {b.variantLabel}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Chip size="sm" tone="neutral">
                          Default
                        </Chip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top whitespace-nowrap">
                      <Chip size="sm" tone="neutral">
                        {b.revision}
                      </Chip>
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top whitespace-nowrap">
                      {product ? (
                        <Chip size="sm" tone={typeTone[product.type] ?? "neutral"}>
                          {typeLabel[product.type] ?? product.type}
                        </Chip>
                      ) : (
                        <span className="text-caption text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-ink">
                        <Boxes size={12} className="text-ink-muted" />
                        {b.items.length}
                      </span>
                      {subCount > 0 && (
                        <div className="text-caption text-primary mt-0.5 inline-flex items-center gap-1">
                          <Layers size={10} /> {subCount} sub
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top text-right whitespace-nowrap">
                      <span className="text-ink font-semibold">{b.outputQty}</span>{" "}
                      <span className="text-caption text-ink-muted">{outputUom}</span>
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top whitespace-nowrap">
                      {b.active ? (
                        <Chip size="sm" tone="success">
                          active
                        </Chip>
                      ) : (
                        <Chip size="sm" tone="danger">
                          inactive
                        </Chip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 border-b border-border/50 align-top whitespace-nowrap text-right">
                      <div
                        className="inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => void onClone(b)}
                          disabled={busy === b.id}
                          className="text-caption text-primary px-2 py-1 hover:bg-primary-50 rounded inline-flex items-center gap-1"
                          title="Clone this BOM (revision bump or to another variant)"
                        >
                          <Copy size={11} /> clone
                        </button>
                        <button
                          onClick={() => void onDelete(b)}
                          disabled={busy === b.id}
                          className="text-caption text-danger px-2 py-1 hover:bg-danger-soft rounded inline-flex items-center gap-1"
                          title="Delete this BOM"
                        >
                          <Trash2 size={11} />
                          {busy === b.id ? "…" : "delete"}
                        </button>
                        <ChevronRight size={14} className="text-ink-muted ml-1" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewBomModal
          products={products}
          bomScopeIndex={bomScopeIndex}
          onClose={() => setShowNew(false)}
          onOpenExisting={(bom) => {
            setShowNew(false);
            onEdit(bom);
          }}
          onConfirm={(productId, variantId) => {
            setShowNew(false);
            onCreate({ productId, variantId });
          }}
        />
      )}
    </div>
  );

  if (isPage) return panel;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-end"
      {...backdropDismissProps(onClose)}
    >
      <div onClick={(e) => e.stopPropagation()}>{panel}</div>
    </div>
  );
};

// ---------- Table header cell with sort affordance ----------

interface ThProps {
  children: React.ReactNode;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}

const Th = ({ children, sortKey, active, dir, onClick, align = "left" }: ThProps) => {
  const isActive = active === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-caption font-semibold text-ink-muted border-b border-border bg-canvas",
        align === "right" ? "text-right" : "text-left",
        "whitespace-nowrap select-none"
      )}
    >
      <button
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-ink",
          align === "right" && "flex-row-reverse",
          isActive && "text-ink"
        )}
      >
        {children}
        <ArrowUpDown
          size={11}
          className={cn(
            "opacity-40",
            isActive && "opacity-100",
            isActive && dir === "desc" && "rotate-180"
          )}
        />
      </button>
    </th>
  );
};

// ---------- New BOM modal: pick product, then variant ----------

interface NewBomModalProps {
  products: Product[];
  bomScopeIndex: Map<string, Bom>;
  onClose: () => void;
  onOpenExisting: (bom: Bom) => void;
  onConfirm: (productId: string, variantId: string | null) => void;
}

export const NewBomModal = ({
  products,
  bomScopeIndex,
  onClose,
  onOpenExisting,
  onConfirm,
}: NewBomModalProps) => {
  // Restrict to products that make sense for BOMs - exclude raw materials
  // since they're inputs, not manufactured outputs. Allow finished, semi,
  // consumable; service rarely has a BOM but we don't forbid it.
  const bomEligible = useMemo(
    () =>
      products.filter(
        (p) =>
          p.state === "active" &&
          (p.type === "finished" ||
            p.type === "semi" ||
            p.type === "consumable")
      ),
    [products]
  );

  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  // null = product-level default scope; string = variant id.
  const [variantId, setVariantId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const product = useMemo(
    () => (productId ? products.find((p) => p.id === productId) ?? null : null),
    [productId, products]
  );

  // When the picked product changes, reset variant selection to a
  // sensible default: prefer the product-level default scope if not
  // taken, else the first variant without a BOM, else the first variant.
  useEffect(() => {
    if (!product) {
      setVariantId(null);
      return;
    }
    const defaultTaken = bomScopeIndex.has(`${product.id}::default`);
    if (!defaultTaken) {
      setVariantId(null);
      return;
    }
    const firstFree = product.variants?.find(
      (v) => v.id && !bomScopeIndex.has(`${product.id}::${v.id}`)
    );
    if (firstFree?.id) {
      setVariantId(firstFree.id);
    } else if (product.variants?.[0]?.id) {
      setVariantId(product.variants[0].id);
    } else {
      setVariantId(null);
    }
  }, [product, bomScopeIndex]);

  const filteredProducts = useMemo(() => {
    const f = productQuery.trim().toLowerCase();
    const list = f
      ? bomEligible.filter(
          (p) =>
            p.sku.toLowerCase().includes(f) ||
            p.name.toLowerCase().includes(f)
        )
      : bomEligible;
    return list.slice(0, 50);
  }, [bomEligible, productQuery]);

  const existing = useMemo(() => {
    if (!product) return null;
    return (
      bomScopeIndex.get(
        `${product.id}::${variantId ?? "default"}`
      ) ?? null
    );
  }, [product, variantId, bomScopeIndex]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
      {...backdropDismissProps(onClose)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full max-w-2xl max-h-[90vh] rounded-lg elevation-3 flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md shrink-0">
              <Plus size={16} />
            </div>
            <div>
              <div className="text-body font-semibold">New BOM</div>
              <div className="text-caption text-ink-muted">
                Pick the parent product and the variant scope, then build the recipe.
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

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Step 1 — parent product */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-5 w-5 grid place-items-center rounded-full bg-primary text-white text-caption font-semibold">
                1
              </span>
              <span className="text-body-sm font-semibold text-ink">
                Parent product
              </span>
              {product && (
                <span className="text-caption text-ink-muted">
                  · selected{" "}
                  <span className="font-mono text-primary">{product.sku}</span>
                </span>
              )}
            </div>
            <Input
              ref={inputRef}
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search by SKU or product name…"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
            />
            <div className="mt-2 border border-border rounded-md max-h-60 overflow-y-auto bg-white">
              {filteredProducts.length === 0 ? (
                <div className="p-4 text-center text-body-sm text-ink-muted">
                  No matching products.
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const isSelected = productId === p.id;
                  const totalScopes = 1 + (p.variants?.length ?? 0);
                  const usedScopes =
                    (bomScopeIndex.has(`${p.id}::default`) ? 1 : 0) +
                    (p.variants?.filter((v) =>
                      v.id ? bomScopeIndex.has(`${p.id}::${v.id}`) : false
                    ).length ?? 0);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setProductId(p.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 border-b border-border/40 hover:bg-canvas flex items-center gap-2",
                        isSelected && "bg-primary-50"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-caption text-primary font-semibold">
                            {p.sku}
                          </span>
                          <Chip
                            size="sm"
                            tone={typeTone[p.type] ?? "neutral"}
                          >
                            {typeLabel[p.type] ?? p.type}
                          </Chip>
                          {(p.variants?.length ?? 0) > 0 && (
                            <Chip size="sm" tone="neutral">
                              {p.variants!.length} variant
                              {p.variants!.length === 1 ? "" : "s"}
                            </Chip>
                          )}
                        </div>
                        <div className="text-body-sm truncate text-ink">
                          {p.name}
                        </div>
                      </div>
                      <div className="shrink-0 text-caption text-ink-muted text-right">
                        {usedScopes}/{totalScopes} scopes
                        <br />
                        with BOM
                      </div>
                      {isSelected && (
                        <Check size={14} className="text-primary shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Step 2 — variant scope */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={cn(
                  "h-5 w-5 grid place-items-center rounded-full text-caption font-semibold",
                  product
                    ? "bg-primary text-white"
                    : "bg-border text-ink-muted"
                )}
              >
                2
              </span>
              <span className="text-body-sm font-semibold text-ink">
                Variant scope
              </span>
              <span className="text-caption text-ink-muted">
                · which variant(s) this BOM applies to
              </span>
            </div>
            {!product ? (
              <div className="border border-dashed border-border rounded-md p-4 text-center text-body-sm text-ink-muted">
                Pick a product above to choose its variant scope.
              </div>
            ) : (
              <div className="border border-border rounded-md overflow-hidden bg-white">
                <VariantOption
                  selected={variantId === null}
                  onSelect={() => setVariantId(null)}
                  title="Product-level default"
                  subtitle="Applies to every variant that doesn't have its own BOM."
                  existingBom={bomScopeIndex.get(`${product.id}::default`)}
                />
                {(product.variants ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-caption text-ink-muted border-t border-border/40 bg-canvas/40">
                    This product has no variants — the default scope above is the only choice.
                  </div>
                ) : (
                  product.variants!.map((v) => {
                    if (!v.id) return null;
                    const existing = bomScopeIndex.get(
                      `${product.id}::${v.id}`
                    );
                    const descriptor = variantDescriptor(v);
                    return (
                      <VariantOption
                        key={v.id}
                        selected={variantId === v.id}
                        onSelect={() => setVariantId(v.id ?? null)}
                        title={v.sku}
                        subtitle={
                          descriptor
                            ? `${descriptor}${v.active ? "" : " · inactive"}`
                            : v.active
                            ? undefined
                            : "inactive"
                        }
                        existingBom={existing}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2 shrink-0 bg-canvas/40">
          <div className="text-caption text-ink-muted">
            {existing ? (
              <>
                A BOM already exists for this scope —{" "}
                <span className="font-semibold text-ink">{existing.revision}</span>.
              </>
            ) : product ? (
              <>
                You'll be taken to the editor to add components and operations.
              </>
            ) : (
              <>Pick a product to continue.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {existing ? (
              <Button
                size="sm"
                icon={<ChevronRight size={14} />}
                onClick={() => onOpenExisting(existing)}
              >
                Open existing
              </Button>
            ) : (
              <Button
                size="sm"
                icon={<Plus size={14} />}
                disabled={!product}
                onClick={() => {
                  if (!product) return;
                  onConfirm(product.id, variantId);
                }}
              >
                Create BOM
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface VariantOptionProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  existingBom?: Bom | null;
}

const VariantOption = ({
  selected,
  onSelect,
  title,
  subtitle,
  existingBom,
}: VariantOptionProps) => {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-2 flex items-center gap-3 border-b border-border/40 last:border-b-0 hover:bg-canvas",
        selected && "bg-primary-50"
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full border-2 shrink-0 grid place-items-center",
          selected ? "border-primary" : "border-border"
        )}
      >
        {selected && <span className="h-2 w-2 bg-primary rounded-full" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-caption text-primary font-semibold">
            {title}
          </span>
          {existingBom && (
            <Chip size="sm" tone="warning">
              already has BOM · {existingBom.revision}
            </Chip>
          )}
        </div>
        {subtitle && (
          <div className="text-caption text-ink-muted truncate">{subtitle}</div>
        )}
      </div>
    </button>
  );
};
