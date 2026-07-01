import { useMemo } from "react";
import { Package } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { effectiveUom, type Product, type ProductType, type ProductVariant } from "@/data/types";
import { formatPackSize, inr, num } from "@/lib/format";
import { resolveUploadUrl } from "@/lib/api";
import { variantLabel } from "@/lib/productSearch";

export type FlatVariantRow = {
  product: Product;
  variant: ProductVariant;
};

const typeChip = (t: ProductType) => {
  const map = {
    raw: { tone: "info" as const, label: "Raw" },
    semi: { tone: "warning" as const, label: "Semi" },
    finished: { tone: "success" as const, label: "Finished" },
    consumable: { tone: "neutral" as const, label: "Consumable" },
    service: { tone: "primary" as const, label: "Service" },
  } as const;
  return map[t];
};

const matchesRow = (row: FlatVariantRow, term: string): boolean => {
  const { product: p, variant: v } = row;
  return (
    v.sku.toLowerCase().includes(term) ||
    (v.barcode ?? "").toLowerCase().includes(term) ||
    (v.size ?? "").toLowerCase().includes(term) ||
    (v.color ?? "").toLowerCase().includes(term) ||
    (v.grade ?? "").toLowerCase().includes(term) ||
    p.name.toLowerCase().includes(term) ||
    p.sku.toLowerCase().includes(term) ||
    (p.barcode ?? "").toLowerCase().includes(term) ||
    (p.category?.name ?? "").toLowerCase().includes(term)
  );
};

interface Props {
  products: Product[];
  q: string;
  type: ProductType | "all";
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onRowClick?: (row: FlatVariantRow) => void;
  selectedKey?: string;
}

export const ProductVariantsTable = ({
  products,
  q,
  type,
  loading,
  error,
  onRetry,
  onRowClick,
  selectedKey,
}: Props) => {
  const filtered = useMemo(() => filterVariantRows(products, q, type), [products, q, type]);

  const allRows = useMemo(
    () =>
      products.flatMap((product) =>
        (product.variants ?? []).map((variant) => ({ product, variant }))
      ),
    [products]
  );

  const columns: Column<FlatVariantRow>[] = [
    {
      key: "image",
      header: "",
      width: "52px",
      cell: (r) => {
        const src =
          resolveUploadUrl(r.variant.imageUrl || r.product.imageUrl) ?? null;
        return src ? (
          <img
            src={src}
            alt={r.variant.sku}
            className="w-9 h-9 object-contain rounded border border-border bg-white"
          />
        ) : (
          <div className="w-9 h-9 rounded border border-border bg-canvas grid place-items-center text-ink-muted">
            <Package size={16} />
          </div>
        );
      },
    },
    {
      key: "variantSku",
      header: "Variant SKU",
      sortable: true,
      sortValue: (r) => r.variant.sku,
      width: "140px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold text-primary">
          {r.variant.sku}
        </span>
      ),
    },
    {
      key: "attributes",
      header: "Variant",
      sortable: true,
      sortValue: (r) => variantLabel(r.variant),
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink">{variantLabel(r.variant)}</div>
          <div className="text-caption text-ink-muted font-mono">
            {r.variant.barcode || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "parent",
      header: "Product",
      sortable: true,
      sortValue: (r) => r.product.name,
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink truncate max-w-[200px]" title={r.product.name}>
            {r.product.name}
          </div>
          <div className="text-caption text-ink-muted font-mono">{r.product.sku}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "100px",
      cell: (r) => {
        const c = typeChip(r.product.type);
        return (
          <Chip tone={c.tone} size="sm">
            {c.label}
          </Chip>
        );
      },
    },
    {
      key: "category",
      header: "Category",
      width: "110px",
      cell: (r) => (
        <span className="text-ink text-caption">{r.product.category?.name ?? "—"}</span>
      ),
    },
    {
      key: "uom",
      header: "UOM",
      width: "70px",
      align: "center",
      cell: (r) => (
        <span className="font-mono text-caption">
          {effectiveUom(r.product, r.variant)}
        </span>
      ),
    },
    {
      key: "packSize",
      header: "Pack",
      align: "right",
      width: "80px",
      sortable: true,
      sortValue: (r) => r.variant.packSize ?? 1,
      cell: (r) => {
        const pack = r.variant.packSize ?? 1;
        return (
          <span className="tnum text-caption text-ink-muted" title={`1 ${effectiveUom(r.product, r.variant)} = ${pack} ${r.product.uom}`}>
            {formatPackSize(pack)} {r.product.uom}
          </span>
        );
      },
    },
    {
      key: "stock",
      header: "On hand",
      align: "right",
      width: "110px",
      sortable: true,
      sortValue: (r) => r.variant.stockOnHand,
      cell: (r) => {
        const incoming =
          (r.product.pipeline?.poPipeline ?? 0) + (r.product.pipeline?.moPipeline ?? 0);
        return (
          <div className="text-right">
            <span
              className={`tnum font-semibold ${
                r.variant.stockOnHand < 0 ? "text-danger" : "text-ink"
              }`}
            >
              {num(r.variant.stockOnHand)}
            </span>
            {incoming > 0 && (
              <div
                className="text-caption text-info tnum"
                title="Parent product — open PO / MO qty (shared across variants)"
              >
                +{num(incoming)} exp.
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      width: "100px",
      sortable: true,
      sortValue: (r) => r.variant.costPriceOverride ?? r.product.costPrice,
      cell: (r) => (
        <span className="tnum text-ink-muted">
          {inr(r.variant.costPriceOverride ?? r.product.costPrice)}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      width: "100px",
      sortable: true,
      sortValue: (r) => r.variant.sellingPriceOverride ?? r.product.sellingPrice,
      cell: (r) => (
        <span className="tnum font-semibold text-ink">
          {inr(r.variant.sellingPriceOverride ?? r.product.sellingPrice)}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      width: "90px",
      cell: (r) => (
        <Chip
          tone={
            r.variant.active && r.product.state === "active" ? "success" : "neutral"
          }
          size="sm"
        >
          {r.variant.active
            ? r.product.state === "active"
              ? "active"
              : r.product.state
            : "inactive"}
        </Chip>
      ),
    },
    {
      key: "channels",
      header: "Channels",
      width: "130px",
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <Chip tone={r.variant.ecommerceEnabled !== false ? "success" : "neutral"} size="sm">
            {r.variant.ecommerceEnabled !== false ? "E-com" : "No e-com"}
          </Chip>
          <Chip tone={r.variant.priceListEnabled !== false ? "info" : "neutral"} size="sm">
            {r.variant.priceListEnabled !== false ? "Pricelist" : "No PL"}
          </Chip>
        </div>
      ),
    },
  ];

  if (loading || error) {
    return (
      <EmptyState
        loading={loading}
        error={error ?? null}
        onRetry={onRetry}
      />
    );
  }

  if (allRows.length === 0) {
    return (
      <EmptyState
        empty
        emptyTitle="No variants yet"
        emptyDescription="Add variants on a product (Edit → Variants) to see them listed here."
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        empty
        emptyTitle="No variants match"
        emptyDescription="Try a different search or clear the type filter."
      />
    );
  }

  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.variant.id ?? `${r.product.id}-${r.variant.sku}`}
      onRowClick={onRowClick}
      selectedKey={selectedKey}
      dense
    />
  );
};

export const countVariantRows = (products: Product[]): number =>
  products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);

export const filterVariantRows = (
  products: Product[],
  q: string,
  type: ProductType | "all"
): FlatVariantRow[] => {
  const term = q.trim().toLowerCase();
  return products.flatMap((product) =>
    (product.variants ?? []).map((variant) => ({ product, variant }))
  ).filter((row) => {
    if (type !== "all" && row.product.type !== type) return false;
    if (!term) return true;
    return matchesRow(row, term);
  });
};
