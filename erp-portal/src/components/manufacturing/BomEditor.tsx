// Multi-level BOM editor.
//
// Layout:
//   * Top header: parent product, revision, output qty, active toggle.
//   * Left: flat editable list of components (the items of *this* BOM).
//     Each row that points at a sub-assembly product shows a "drill in"
//     button that switches the right pane to its tree.
//   * Right: live multi-level explosion tree showing what an MO of
//     `previewQty` (default 1) actually consumes - mirrors what the
//     backend would compute on /boms/:id/tree.
//
// Saving: PATCH /boms/:id with the full items[] array. The backend
// uses replace-all semantics so removed rows disappear and reorders
// are non-destructive. New BOMs use POST /boms.
//
// "Where used" is shown for the root product so the operator can see
// what depends on this BOM before they break it.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  Network,
  Package,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { UomPicker } from "@/components/common/UomPicker";
import { useApi } from "@/hooks/useApi";
import { useUoms } from "@/hooks/useUoms";
import { num } from "@/lib/format";
import {
  api,
  type BomTreeNode,
  type VariantsWithBomsRow,
  type WhereUsedRow,
} from "@/lib/api";
import { effectiveUom } from "@/data/types";
import type { Bom, BomByproductRow, BomItem, Product } from "@/data/types";
import { cn } from "@/lib/cn";

interface Props {
  // Existing BOM to edit, or null/undefined to create a new one for
  // `seedProductId` (passed only when creating).
  bom?: Bom | null;
  seedProductId?: string;
  // When creating a new variant-level BOM, the caller can pre-select
  // which variant this BOM applies to.
  seedVariantId?: string | null;
  products: Product[];
  /** Full-page route vs centered modal overlay. */
  variant?: "page" | "modal";
  onClose: () => void;
  onSaved: (bomId: string, message: string) => void;
}

// Working copy of the items list - mutable, validated client-side
// before submit.
type EditableItem = BomItem & { tempKey: string };
type EditableByproduct = BomByproductRow & { tempKey: string };

const fresh = (productId?: string, products?: Product[]): EditableItem => {
  const p = products?.find((x) => x.id === productId);
  return {
    tempKey: Math.random().toString(36).slice(2),
    productId,
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    qty: 1,
    // Default to the component product's primary UoM (already
    // canonicalised in the catalog) so users rarely have to touch
    // it. Falls back to "pc" - the safest, most generic count UoM.
    uom: p?.uom ?? "pc",
    scrapPct: 0,
    hasSubAssembly: p?.type === "semi",
  };
};

const freshByproduct = (
  productId?: string,
  products?: Product[]
): EditableByproduct => {
  const p = products?.find((x) => x.id === productId);
  return {
    tempKey: Math.random().toString(36).slice(2),
    productId,
    variantId: null,
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    qty: 1,
    uom: p?.uom ?? "pc",
    costShare: 0,
  };
};

export const BomEditor = ({
  bom,
  seedProductId,
  seedVariantId,
  products,
  variant = "modal",
  onClose,
  onSaved,
}: Props) => {
  const isNew = !bom;
  const isPage = variant === "page";

  // Parent product - editable only when creating a new BOM. When
  // creating without a seed, prefer a product that has variants
  // (with active ones first) so the variant scope picker is
  // immediately useful.
  const defaultParentId = useMemo(() => {
    if (bom?.productId) return bom.productId;
    if (seedProductId) return seedProductId;
    const withActiveVariants = products.find(
      (p) => p.variants?.some((v) => v.active)
    );
    if (withActiveVariants) return withActiveVariants.id;
    const withAnyVariants = products.find(
      (p) => (p.variants?.length ?? 0) > 0
    );
    if (withAnyVariants) return withAnyVariants.id;
    return products[0]?.id ?? "";
  }, [bom?.productId, seedProductId, products]);
  const [parentId, setParentId] = useState<string>(defaultParentId);
  const parentProduct = useMemo(
    () => products.find((p) => p.id === parentId),
    [products, parentId]
  );

  // Variant scope of this BOM:
  //   null = product-level default (applies to any variant without
  //          its own BOM)
  //   string = this BOM applies only to that variant
  // Editable only when creating; cloning to a different variant is
  // a separate explicit action.
  const [variantId, setVariantId] = useState<string | null>(
    bom?.variantId ?? seedVariantId ?? null
  );

  // The "Batch size" / "Quantities entered for a batch of N" labels
  // describe the OUTPUT of one batch. Output unit is:
  //   * variant.uom (or parent.uom if variant inherits) when the BOM
  //     is variant-scoped (the BOM produces variant units, e.g. 1 pc
  //     of 100 g almond pack).
  //   * parent.uom when the BOM is product-level.
  // (Declared AFTER variantId because it depends on that state.)
  const outputContext = useMemo(() => {
    if (!parentProduct) return { uom: "unit", note: null as string | null };
    const v = variantId
      ? parentProduct.variants?.find((x) => x.id === variantId)
      : null;
    if (v) {
      const uom = effectiveUom(parentProduct, v);
      const pack = v.packSize && v.packSize > 0 ? v.packSize : 1;
      const note =
        uom !== parentProduct.uom
          ? `1 ${uom} of ${v.sku} = ${pack} ${parentProduct.uom} of ${parentProduct.sku}`
          : null;
      return { uom, note };
    }
    return { uom: parentProduct.uom, note: null };
  }, [parentProduct, variantId]);

  // Live snapshot of "what variants of this product exist and which
  // already have their own BOM" - drives the variant chip strip.
  const [variantsInfo, setVariantsInfo] =
    useState<VariantsWithBomsRow | null>(null);

  const [revision, setRevision] = useState(bom?.revision ?? "Rev-1.0");
  const [outputQty, setOutputQty] = useState(bom?.outputQty ?? 1);
  const [active, setActive] = useState(bom?.active ?? true);
  // Default work center / machine for MOs created from this BOM.
  // Both empty string here = "no default", which we serialise as null
  // on the wire. Loaded once from useApi below.
  const [defaultWorkCenterId, setDefaultWorkCenterId] = useState<string>(
    bom?.defaultWorkCenterId ?? ""
  );
  const [defaultMachineId, setDefaultMachineId] = useState<string>(
    bom?.defaultMachineId ?? ""
  );
  const workCentersResp = useApi(() => api.workCenters({ active: true }), []);
  const machinesResp = useApi(() => api.machines({ active: true }), []);
  const workCenterOptions = useMemo(
    () =>
      ((workCentersResp.data as Array<{
        id: string;
        code: string;
        name: string;
      }> | null) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [workCentersResp.data]
  );
  const machineOptions = useMemo(
    () =>
      ((machinesResp.data as Array<{
        id: string;
        code: string;
        name: string;
        workCenterId: string;
      }> | null) ?? [])
        .filter(
          (m) =>
            !defaultWorkCenterId || m.workCenterId === defaultWorkCenterId
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [machinesResp.data, defaultWorkCenterId]
  );
  // If the operator picks a different WC, the previously picked machine
  // (which lived on the old WC) is no longer valid - clear it.
  useEffect(() => {
    if (!defaultMachineId) return;
    const all = (machinesResp.data as Array<{
      id: string;
      workCenterId: string;
    }> | null) ?? [];
    const m = all.find((x) => x.id === defaultMachineId);
    if (
      defaultWorkCenterId &&
      m &&
      m.workCenterId !== defaultWorkCenterId
    ) {
      setDefaultMachineId("");
    }
  }, [defaultWorkCenterId, defaultMachineId, machinesResp.data]);

  const [items, setItems] = useState<EditableItem[]>(
    () =>
      (bom?.items ?? []).map((i) => ({
        ...i,
        tempKey: Math.random().toString(36).slice(2),
      }))
  );
  const [byproducts, setByproducts] = useState<EditableByproduct[]>(
    () =>
      (bom?.byproducts ?? []).map((b) => ({
        ...b,
        tempKey: Math.random().toString(36).slice(2),
      }))
  );
  const [bomTab, setBomTab] = useState<"consumed" | "released">("consumed");

  // Right-pane preview: which BOM are we visualising? When the root
  // BOM exists (edit mode) we always preview it. When the user clicks
  // "drill in" on a sub-assembly row we switch to that sub-BOM.
  const [previewBomId, setPreviewBomId] = useState<string | null>(
    bom?.id ?? null
  );
  const [previewQty, setPreviewQty] = useState<number>(1);
  const [tree, setTree] = useState<BomTreeNode | null>(null);
  const [whereUsed, setWhereUsed] = useState<WhereUsedRow[]>([]);

  const [busy, setBusy] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null); // tempKey
  const [showAddRow, setShowAddRow] = useState(false);
  const [showAddByproduct, setShowAddByproduct] = useState(false);

  // Load variant info whenever the parent product changes. Also
  // reset the selected variant scope when the user switches parent
  // mid-creation, since a variantId from one product is invalid for
  // another - leaving the stale id would cause a backend rejection
  // on save with a confusing error.
  // version counter lets imperative actions (e.g. generate default
  // BOMs) trigger a refetch without duplicating the fetch code.
  const [variantsInfoVersion, setVariantsInfoVersion] = useState(0);
  useEffect(() => {
    if (!parentId) {
      setVariantsInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const info = await api.variantsWithBoms(parentId);
        if (cancelled) return;
        setVariantsInfo(info);
        if (isNew) {
          setVariantId((prev) => {
            if (prev === null) return null;
            const stillBelongs = info.variants.some((v) => v.id === prev);
            return stillBelongs ? prev : null;
          });
        }
      } catch {
        if (!cancelled) setVariantsInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentId, isNew, variantsInfoVersion]);

  // Count variants that don't have an active BOM yet - we only show the
  // "Generate default BOMs" button when there's at least one to make.
  const variantsMissingBom =
    variantsInfo?.variants.filter((v) => !v.activeBom).length ?? 0;
  const [generating, setGenerating] = useState(false);
  const handleGenerateDefaults = async () => {
    if (!parentId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateDefaultBoms(parentId);
      setVariantsInfoVersion((v) => v + 1);
      if (result.created.length === 0) {
        setError(
          `No variants needed a default BOM. ${result.skipped.length} were skipped (already had one).`
        );
      } else {
        setError(
          `Generated ${result.created.length} default BOM${result.created.length === 1 ? "" : "s"}. ` +
            `Each consumes the parent product per the variant's pack size. Review and tweak as needed.`
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  // Refresh the explosion preview when the previewed BOM or qty
  // change. Skipped while no BOM exists yet (new-mode before save).
  useEffect(() => {
    if (!previewBomId) {
      setTree(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await api.bomTree(previewBomId, previewQty);
        if (!cancelled) setTree(fresh);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewBomId, previewQty]);

  // Where-used for the root product, refreshed once on mount.
  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.whereUsed(parentId);
        if (!cancelled) setWhereUsed(rows);
      } catch {
        // non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentId]);

  // ---------------------------------------------------------------- mutations

  const addItem = (productId?: string) => {
    setItems((cur) => [...cur, fresh(productId, products)]);
    setShowAddRow(false);
  };

  const updateItem = (key: string, patch: Partial<EditableItem>) => {
    setItems((cur) =>
      cur.map((i) => {
        if (i.tempKey !== key) return i;
        const next = { ...i, ...patch };
        if (patch.productId) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            next.sku = p.sku;
            next.name = p.name;
            next.uom = p.uom;
            next.hasSubAssembly = p.type === "semi";
          }
        }
        return next;
      })
    );
  };

  const removeItem = (key: string) =>
    setItems((cur) => cur.filter((i) => i.tempKey !== key));

  const addByproduct = (productId?: string) => {
    setByproducts((cur) => [...cur, freshByproduct(productId, products)]);
    setShowAddByproduct(false);
  };

  const updateByproduct = (key: string, patch: Partial<EditableByproduct>) => {
    setByproducts((cur) =>
      cur.map((b) => {
        if (b.tempKey !== key) return b;
        const next = { ...b, ...patch };
        if (patch.productId) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            next.sku = p.sku;
            next.name = p.name;
            next.uom = p.uom;
            next.variantId = null;
            next.variantSku = null;
          }
        }
        return next;
      })
    );
  };

  const removeByproduct = (key: string) =>
    setByproducts((cur) => cur.filter((b) => b.tempKey !== key));

  const costShareTotal = useMemo(
    () => byproducts.reduce((s, b) => s + (b.costShare ?? 0), 0),
    [byproducts]
  );

  const totalScrapWeighted = useMemo(() => {
    if (items.length === 0) return 0;
    return (
      items.reduce((s, i) => s + (i.scrapPct ?? 0), 0) / items.length
    );
  }, [items]);

  const validate = (): string | null => {
    if (!parentId) return "Pick a parent product.";
    if (!revision.trim()) return "Revision is required.";
    if (outputQty <= 0) return "Output qty must be greater than zero.";
    for (const it of items) {
      if (!it.productId) return `Pick a product for every component.`;
      // Self-reference (component == parent) is OK on a variant-scoped
      // BOM (the "packaging BOM" pattern: variant 100 g pack consumes
      // 0.1 kg of the bulk parent). It remains rejected on product-
      // level BOMs because that would be a true cycle.
      if (it.productId === parentId && !variantId) {
        return `"${it.name || it.sku}" cannot be a component of its own parent (cycle).`;
      }
      if (!it.qty || it.qty <= 0) return `Qty must be > 0 for ${it.sku}.`;
      if (!it.uom) return `UoM is required for ${it.sku}.`;
      if ((it.scrapPct ?? 0) < 0 || (it.scrapPct ?? 0) > 100)
        return `Scrap % out of range for ${it.sku}.`;
    }
    // Duplicate component check.
    const seen = new Set<string>();
    for (const it of items) {
      if (it.productId && seen.has(it.productId)) {
        return `"${it.sku}" appears twice - merge the rows.`;
      }
      if (it.productId) seen.add(it.productId);
    }
    for (const bp of byproducts) {
      if (!bp.productId) return "Pick a product for every released component.";
      if (bp.productId === parentId) {
        return "The main finished product cannot be a released by-product.";
      }
      if (!bp.qty || bp.qty <= 0) return `Qty must be > 0 for released ${bp.sku}.`;
      if (!bp.uom) return `UoM is required for released ${bp.sku}.`;
      if ((bp.costShare ?? 0) < 0 || (bp.costShare ?? 0) > 100) {
        return `Cost share % out of range for ${bp.sku}.`;
      }
    }
    const bpSeen = new Set<string>();
    for (const bp of byproducts) {
      const key = `${bp.productId}|${bp.variantId ?? ""}`;
      if (bpSeen.has(key)) {
        return `"${bp.sku}" appears twice in released components — merge the rows.`;
      }
      bpSeen.add(key);
    }
    if (costShareTotal > 100.0001) {
      return `Total cost share is ${costShareTotal.toFixed(1)}% (max 100%).`;
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    const payload = {
      productId: parentId,
      variantId,
      revision: revision.trim(),
      outputQty,
      active,
      defaultWorkCenterId: defaultWorkCenterId || null,
      defaultMachineId: defaultMachineId || null,
      items: items.map((i) => ({
        productId: i.productId!,
        qty: i.qty,
        uom: i.uom,
        scrapPct: i.scrapPct,
      })),
      byproducts: byproducts.map((b) => ({
        productId: b.productId!,
        variantId: b.variantId ?? null,
        qty: b.qty,
        uom: b.uom,
        costShare: b.costShare ?? 0,
      })),
    };
    try {
      let id: string;
      if (isNew) {
        const created = (await api.createBom(payload)) as { id: string };
        id = created.id;
      } else {
        // variantId / productId are immutable on update - drop them
        // before sending so the server doesn't see fields it would
        // refuse anyway.
        const { productId: _p, variantId: _v, ...rest } = payload;
        const updated = (await api.updateBom(bom!.id, rest)) as { id: string };
        id = updated.id;
      }
      onSaved(
        id,
        isNew
          ? variantId
            ? "Variant-specific BOM created."
            : "Product-level BOM created."
          : "BOM saved."
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // Clone the existing BOM to one or more *other* variant scopes.
  // Caller picks targets in the inline modal; we POST one clone per
  // target. Each succeeds independently so a partial failure (e.g.
  // one variant already has an active BOM) doesn't abort the rest.
  const cloneTo = async (targets: Array<string | null>) => {
    if (!bom) return;
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    let okCount = 0;
    for (const target of targets) {
      try {
        await api.cloneBom(bom.id, { variantId: target, setActive: true });
        okCount += 1;
      } catch (e) {
        const label =
          target === null
            ? "product-level"
            : variantsInfo?.variants.find((v) => v.id === target)?.label ??
              target;
        failures.push(`${label}: ${(e as Error).message}`);
      }
    }
    setCloneOpen(false);
    setBusy(false);
    if (failures.length === 0) {
      onSaved(bom.id, `Cloned to ${okCount} variant(s).`);
    } else if (okCount > 0) {
      setError(
        `Cloned ${okCount}; ${failures.length} failed: ${failures.join("; ")}`
      );
    } else {
      setError(`All clones failed: ${failures.join("; ")}`);
    }
  };

  // ---------------------------------------------------------------- render

  const editor = (
      <div
        className={cn(
          "bg-surface overflow-hidden flex flex-col",
          isPage
            ? "h-full min-h-0 w-full"
            : "w-[1100px] max-w-[95vw] h-[92vh] max-h-[92vh] rounded-lg elevation-3"
        )}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isPage && (
              <Link
                to="/manufacturing/boms"
                className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas shrink-0"
                title="Back to BOM list"
              >
                <ArrowLeft size={18} />
              </Link>
            )}
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md shrink-0">
              <Network size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-caption text-ink-muted uppercase font-semibold flex items-center gap-2">
                {isNew ? "New BOM" : "Edit BOM"}
                {bom?.variantId ? (
                  <Chip size="sm" tone="primary" icon={<Package size={10} />}>
                    {bom.variantLabel ?? bom.variantSku ?? "variant"}
                  </Chip>
                ) : !isNew ? (
                  <Chip size="sm" tone="neutral">Product-level (default)</Chip>
                ) : null}
              </div>
              <div className="text-body-sm truncate">
                {parentProduct
                  ? `${parentProduct.sku} · ${parentProduct.name}`
                  : "Pick a parent product"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button
                size="sm"
                variant="outline"
                icon={<Copy size={14} />}
                onClick={() => setCloneOpen(true)}
                disabled={busy}
              >
                Clone…
              </Button>
            )}
            {!isPage && (
              <button
                onClick={onClose}
                className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Page mode: scroll settings + components; modal keeps flex split. */}
        <div
          className={cn(
            isPage ? "flex-1 min-h-0 overflow-y-auto" : "flex-1 min-h-0 flex flex-col overflow-hidden"
          )}
        >
        {/* Variant scope strip.
            Always rendered in create mode so the concept is visible
            even before the user picks a variant-bearing parent. In
            edit mode the source BOM's scope is highlighted but pills
            are disabled - cloning to another scope is the explicit
            way to copy. */}
        {(isNew || (variantsInfo && variantsInfo.variants.length > 0)) && (
          <div className="px-5 py-2 border-b border-border bg-primary-50/40 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-caption text-ink-muted uppercase font-semibold shrink-0">
                Variant scope
              </span>
              {/* Horizontally scrollable so the strip stays a single
                  row even with 7+ variants - keeps the components
                  panel below tall enough to actually use. */}
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mb-0.5 flex-1 min-w-0">
                <VariantPill
                  label="Product-level"
                  sub="default"
                  hint={
                    variantsInfo?.productLevelBom
                      ? `${variantsInfo.productLevelBom.componentCount} comp.`
                      : "no BOM"
                  }
                  hasBom={!!variantsInfo?.productLevelBom}
                  selected={variantId === null}
                  disabled={!isNew}
                  onClick={() => setVariantId(null)}
                />
                {variantsInfo?.variants.map((v) => (
                  <VariantPill
                    key={v.id}
                    label={v.label}
                    sub={v.sku}
                    hint={
                      v.activeBom
                        ? `${v.activeBom.componentCount} comp.`
                        : v.inheritsFromProductLevel
                          ? "inherits"
                          : "no BOM"
                    }
                    hasBom={!!v.activeBom}
                    selected={variantId === v.id}
                    disabled={!isNew}
                    onClick={() => setVariantId(v.id)}
                  />
                ))}
              </div>
              {!isNew && (
                <span className="text-caption text-ink-muted shrink-0 hidden lg:inline">
                  (use <strong>Clone…</strong> to switch variant)
                </span>
              )}
              {/* Auto-generate a packaging BOM for every variant that
                  doesn't already have one. The generated BOM consumes
                  the parent product at qty = variant.packSize, in the
                  parent's stock UoM. Hidden when nothing's missing. */}
              {parentId && variantsMissingBom > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Plus size={14} />}
                  onClick={handleGenerateDefaults}
                  disabled={generating}
                  className="shrink-0"
                  title={`Create a default packaging BOM for ${variantsMissingBom} variant${variantsMissingBom === 1 ? "" : "s"} that don't have one yet. Each consumes the parent at qty = packSize.`}
                >
                  {generating
                    ? "Generating…"
                    : `Generate default BOMs (${variantsMissingBom})`}
                </Button>
              )}
            </div>
            {/* Helpful note when the parent product has no active
                variants - explains why only "Product-level" is
                shown so users don't think the picker is broken. */}
            {isNew && (!variantsInfo || variantsInfo.variants.length === 0) && (
              <div className="text-caption text-ink-muted mt-1 ml-1">
                {parentProduct
                  ? `${parentProduct.sku} has no active variants - this BOM will apply at the product level.`
                  : "Pick a parent product below to see its variants."}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="underline text-caption"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Top settings strip */}
        <div className="px-5 py-3 grid grid-cols-12 gap-3 border-b border-border bg-canvas shrink-0">
          <div className="col-span-4">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Parent product
            </div>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={!isNew}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary disabled:bg-canvas disabled:text-ink-muted"
            >
              {products.map((p) => {
                const variantCount = p.variants?.length ?? 0;
                const activeVariantCount =
                  p.variants?.filter((v) => v.active).length ?? 0;
                const suffix =
                  activeVariantCount > 0
                    ? ` · ${activeVariantCount} variant${activeVariantCount === 1 ? "" : "s"}`
                    : variantCount > 0
                      ? ` · ${variantCount} variant${variantCount === 1 ? "" : "s"} (inactive)`
                      : "";
                return (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                    {suffix}
                  </option>
                );
              })}
            </select>
            {isNew && parentProduct && (
              <div className="text-caption text-ink-muted mt-1">
                {(() => {
                  const total = parentProduct.variants?.length ?? 0;
                  const active =
                    parentProduct.variants?.filter((v) => v.active).length ?? 0;
                  if (active > 0)
                    return `${active} active variant${active === 1 ? "" : "s"} - pick a scope above`;
                  if (total > 0)
                    return `${total} variant${total === 1 ? "" : "s"} defined but inactive`;
                  return "no variants - product-level BOM only";
                })()}
              </div>
            )}
          </div>
          <div className="col-span-2">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Revision
            </div>
            <Input
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="Rev-1.0"
            />
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-2">
              <span>Batch size</span>
              <span className="text-ink-muted/70 normal-case font-normal">
                (output produced per batch run)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0.001}
                step={0.001}
                value={outputQty}
                onChange={(e) => setOutputQty(Number(e.target.value) || 1)}
                className="flex-1"
              />
              <span className="text-body-sm text-ink-muted px-1">
                {outputContext.uom}
              </span>
            </div>
            {outputContext.note && (
              <div className="text-caption text-ink-muted mt-1">
                {outputContext.note}
              </div>
            )}
            {/* Quick presets - one tap to set common batch sizes
                (e.g. 50/100/500). These also help users understand
                the field is a batch quantity, not a per-unit yield. */}
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-caption text-ink-muted">presets:</span>
              {[1, 50, 100, 500, 1000].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setOutputQty(n)}
                  className={cn(
                    "text-caption px-1.5 py-0.5 rounded border transition-colors",
                    outputQty === n
                      ? "border-primary bg-primary text-white"
                      : "border-border bg-white text-ink-muted hover:bg-canvas hover:text-ink"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Status
            </div>
            <div className="h-10 flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <span className="text-body-sm">{active ? "Active" : "Inactive"}</span>
              </label>
            </div>
          </div>
          <div className="col-span-1">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Avg scrap
            </div>
            <div className="h-10 flex items-center font-bold tnum">
              {totalScrapWeighted.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Production routing: optional defaults that flow into a new
            MO created from this BOM. Operators can override at MO time;
            this just removes the per-order retyping when every batch
            runs on the same line. Leaving both blank is a valid choice
            (no preselection). */}
        <div className="px-5 py-3 grid grid-cols-12 gap-3 border-b border-border bg-canvas shrink-0">
          <div className="col-span-4">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-2">
              <span>Default work center</span>
              <span className="text-ink-muted/70 normal-case font-normal">
                (used to pre-fill new MOs)
              </span>
            </div>
            <select
              value={defaultWorkCenterId}
              onChange={(e) => setDefaultWorkCenterId(e.target.value)}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
            >
              <option value="">— No default —</option>
              {workCenterOptions.map((wc) => (
                <option key={wc.id} value={wc.id}>
                  {wc.code} · {wc.name}
                </option>
              ))}
            </select>
            {workCenterOptions.length === 0 && (
              <div className="text-caption text-ink-muted mt-1">
                No work centers yet. Add them in <strong>Settings &raquo; Production lines</strong>.
              </div>
            )}
          </div>
          <div className="col-span-4">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-2">
              <span>Default machine</span>
              <span className="text-ink-muted/70 normal-case font-normal">
                (optional, scoped to the work center)
              </span>
            </div>
            <select
              value={defaultMachineId}
              onChange={(e) => setDefaultMachineId(e.target.value)}
              disabled={!defaultWorkCenterId}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary disabled:bg-canvas disabled:text-ink-muted"
            >
              <option value="">
                {defaultWorkCenterId
                  ? "— Any machine on this line —"
                  : "— Pick a work center first —"}
              </option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </option>
              ))}
            </select>
            {defaultWorkCenterId && machineOptions.length === 0 && (
              <div className="text-caption text-ink-muted mt-1">
                No machines on this work center yet.
              </div>
            )}
          </div>
          <div className="col-span-4 flex items-end">
            <div className="text-caption text-ink-muted">
              Operators can still override the station/machine when
              creating a manufacturing order.
            </div>
          </div>
        </div>

        {/* Body: split editor + preview */}
        <div
          className={cn(
            "grid grid-cols-12",
            isPage ? "min-h-[22rem]" : "flex-1 min-h-0"
          )}
        >
          {/* Left: consumed / released */}
          <div
            className={cn(
              "col-span-7 border-r border-border flex flex-col",
              !isPage && "min-h-0"
            )}
          >
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "px-3 py-1.5 rounded-md text-body-sm font-semibold",
                  bomTab === "consumed"
                    ? "bg-primary text-white"
                    : "text-ink-muted hover:bg-canvas"
                )}
                onClick={() => setBomTab("consumed")}
              >
                Consumed ({items.length})
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1.5 rounded-md text-body-sm font-semibold",
                  bomTab === "released"
                    ? "bg-primary text-white"
                    : "text-ink-muted hover:bg-canvas"
                )}
                onClick={() => setBomTab("released")}
              >
                Released ({byproducts.length})
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold">
                  {bomTab === "consumed"
                    ? `Consumed components`
                    : `Released (by-products)`}
                </div>
                <div className="text-caption text-ink-muted">
                  Per batch of {num(outputQty)} {outputContext.uom}
                  {bomTab === "released" && byproducts.length > 0 && (
                    <>
                      {" "}
                      · cost share{" "}
                      <span
                        className={cn(
                          costShareTotal > 100 ? "text-danger font-semibold" : ""
                        )}
                      >
                        {costShareTotal.toFixed(1)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
              {bomTab === "consumed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Plus size={14} />}
                  onClick={() => setShowAddRow(true)}
                >
                  Add component
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Plus size={14} />}
                  onClick={() => setShowAddByproduct(true)}
                >
                  Add released
                </Button>
              )}
            </div>
            {/* Two-area layout so the picker can grow to fill the
                column when components list is short, instead of
                being squeezed into a tiny strip below. */}
            <div
              className={cn(
                "flex flex-col",
                !isPage && "flex-1 min-h-0"
              )}
            >
              {bomTab === "released" && costShareTotal > 100 && (
                <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-caption flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Cost share total exceeds 100% — reduce shares before saving.
                </div>
              )}
              <div
                className={cn(
                  isPage ? "" : "overflow-y-auto",
                  !isPage &&
                    ((bomTab === "consumed" ? items.length : byproducts.length) === 0
                      ? "shrink-0"
                      : "flex-1 min-h-0")
                )}
              >
                {bomTab === "consumed" &&
                items.length === 0 &&
                !showAddRow ? (
                  <div className="p-8 text-center text-body-sm text-ink-muted">
                    No components yet. Click <strong>Add component</strong> to start.
                  </div>
                ) : bomTab === "released" &&
                  byproducts.length === 0 &&
                  !showAddByproduct ? (
                  <div className="p-8 text-center text-body-sm text-ink-muted">
                    No released components. Add by-products or co-products posted when
                    the MO completes.
                  </div>
                ) : bomTab === "consumed" ? (
                  <div className="divide-y divide-border">
                    {items.map((it) => (
                      <ComponentRow
                        key={it.tempKey}
                        item={it}
                        products={products}
                        isPickerOpen={pickerFor === it.tempKey}
                        onPickerOpen={() => setPickerFor(it.tempKey)}
                        onPickerClose={() => setPickerFor(null)}
                        onPick={(productId) => {
                          updateItem(it.tempKey, { productId });
                          setPickerFor(null);
                        }}
                        onPatch={(patch) => updateItem(it.tempKey, patch)}
                        onRemove={() => removeItem(it.tempKey)}
                        onDrillIn={async () => {
                          if (!it.productId) return;
                          const found = await api.boms({
                            productId: it.productId,
                            active: true,
                          });
                          if (found[0]) {
                            setPreviewBomId(found[0].id);
                            setPreviewQty(it.qty * (previewQty || 1));
                          } else {
                            setError(
                              `${it.sku} has no active BOM yet - this is a leaf component.`
                            );
                          }
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {byproducts.map((bp) => {
                      const bpProduct = products.find((p) => p.id === bp.productId);
                      const variantOptions =
                        bpProduct?.variants?.filter((v) => v.active) ?? [];
                      return (
                        <div
                          key={bp.tempKey}
                          className="px-4 py-3 grid grid-cols-12 gap-2 items-start"
                        >
                          <div className="col-span-5">
                            <div className="text-body-sm font-semibold truncate">
                              {bp.name || "Pick product"}
                            </div>
                            <div className="font-mono text-caption text-ink-muted">
                              {bp.sku || "—"}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1"
                              onClick={() => setPickerFor(bp.tempKey)}
                            >
                              Change product
                            </Button>
                          </div>
                          <div className="col-span-2">
                            <label className="text-caption text-ink-muted">Qty</label>
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              step="any"
                              value={bp.qty}
                              onChange={(e) =>
                                updateByproduct(bp.tempKey, {
                                  qty: parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-caption text-ink-muted">UoM</label>
                            <UomPicker
                              value={bp.uom}
                              onChange={(uom) => updateByproduct(bp.tempKey, { uom })}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-caption text-ink-muted">
                              Cost %
                            </label>
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={bp.costShare}
                              onChange={(e) =>
                                updateByproduct(bp.tempKey, {
                                  costShare: parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Trash2 size={14} />}
                              onClick={() => removeByproduct(bp.tempKey)}
                              aria-label="Remove"
                            />
                          </div>
                          {variantOptions.length > 0 && (
                            <div className="col-span-12">
                              <label className="text-caption text-ink-muted">
                                Variant (optional)
                              </label>
                              <select
                                className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-body-sm"
                                value={bp.variantId ?? ""}
                                onChange={(e) => {
                                  const vid = e.target.value || null;
                                  const v = variantOptions.find((x) => x.id === vid);
                                  updateByproduct(bp.tempKey, {
                                    variantId: vid,
                                    variantSku: v?.sku ?? null,
                                  });
                                }}
                              >
                                <option value="">Any / product-level stock</option>
                                {variantOptions.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.sku}
                                    {v.size ? ` · ${v.size}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {pickerFor === bp.tempKey && (
                            <div className="col-span-12 border-t border-border pt-2 space-y-2">
                              <Input
                                size="sm"
                                iconLeft={<Search size={14} />}
                                placeholder="Search by SKU or name…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                              />
                              <ProductPickList
                                products={products}
                                search={search}
                                excludeId={parentId}
                                excludeIds={byproducts
                                  .filter((x) => x.tempKey !== bp.tempKey)
                                  .map((x) => x.productId)
                                  .filter(Boolean) as string[]}
                                onPick={(p) => {
                                  updateByproduct(bp.tempKey, { productId: p.id });
                                  setPickerFor(null);
                                  setSearch("");
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {showAddRow && bomTab === "consumed" && (
                <div
                  className={cn(
                    "border-t border-border bg-canvas flex flex-col min-h-0",
                    items.length === 0 ? "flex-1" : "max-h-[55%]"
                  )}
                >
                  <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
                    <div className="text-caption text-ink-muted uppercase font-semibold flex-1">
                      Pick a product to add as component
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowAddRow(false);
                        setSearch("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="px-3 pb-2 shrink-0">
                    <Input
                      size="sm"
                      autoFocus
                      iconLeft={<Search size={14} />}
                      placeholder="Search by SKU or name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 min-h-0 px-3 pb-3">
                    <ProductPickList
                      products={products}
                      search={search}
                      excludeId={
                        // For variant-level BOMs the parent product is a valid
                        // consumed input (e.g. AJWN-100G-01 consumes 0.1 kg of
                        // bulk AJWN). Only block self-reference on product-level
                        // BOMs where it would be a true cycle.
                        variantId ? undefined : parentId
                      }
                      excludeIds={items
                        .map((i) => i.productId)
                        .filter(Boolean) as string[]}
                      onPick={(p) => {
                        addItem(p.id);
                        setSearch("");
                      }}
                      fillHeight
                    />
                  </div>
                </div>
              )}
              {showAddByproduct && bomTab === "released" && (
                <div
                  className={cn(
                    "border-t border-border bg-canvas flex flex-col min-h-0",
                    byproducts.length === 0 ? "flex-1" : "max-h-[55%]"
                  )}
                >
                  <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
                    <div className="text-caption text-ink-muted uppercase font-semibold flex-1">
                      Pick a product to add as released output
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowAddByproduct(false);
                        setSearch("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="px-3 pb-2 shrink-0">
                    <Input
                      size="sm"
                      autoFocus
                      iconLeft={<Search size={14} />}
                      placeholder="Search by SKU or name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 min-h-0 px-3 pb-3">
                    <ProductPickList
                      products={products}
                      search={search}
                      excludeId={parentId}
                      excludeIds={byproducts
                        .map((b) => b.productId)
                        .filter(Boolean) as string[]}
                      onPick={(p) => {
                        addByproduct(p.id);
                        setSearch("");
                      }}
                      fillHeight
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: live tree + where-used */}
          <div
            className={cn(
              "col-span-5 flex flex-col bg-canvas",
              !isPage && "min-h-0"
            )}
          >
            <div className="px-4 py-2 border-b border-border bg-surface flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-caption text-ink-muted uppercase font-semibold">
                  Live explosion
                </div>
                <div className="text-caption text-ink-muted truncate">
                  Walks every level. Save first to refresh after edits.
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-caption text-ink-muted">Order qty</span>
                <input
                  type="number"
                  value={previewQty}
                  min={1}
                  onChange={(e) => setPreviewQty(Number(e.target.value) || 1)}
                  className="w-16 h-7 border border-border rounded text-center tnum focus:border-primary outline-none"
                />
                <span className="text-caption text-ink-muted">
                  {outputContext.uom}
                </span>
              </div>
            </div>
            <div
              className={cn(
                "p-3",
                isPage ? "min-h-[12rem]" : "flex-1 min-h-0 overflow-y-auto"
              )}
            >
              {!previewBomId ? (
                <div className="text-body-sm text-ink-muted p-3 text-center">
                  Save the BOM to see the live multi-level explosion.
                </div>
              ) : tree ? (
                <TreeNodeView
                  node={tree}
                  depth={0}
                  parentProduct={parentProduct ?? null}
                />
              ) : (
                <div className="text-body-sm text-ink-muted">Loading tree…</div>
              )}
              {whereUsed.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-1.5">
                    Where used ({whereUsed.length})
                  </div>
                  <div className="space-y-1">
                    {whereUsed.map((w) => (
                      <div
                        key={w.bomId}
                        className="flex items-center justify-between text-body-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-caption text-primary">
                            {w.parentSku}
                          </div>
                          <div className="truncate text-caption text-ink-muted">
                            {w.parentName}
                          </div>
                        </div>
                        <span className="tnum text-caption text-ink-muted">
                          {num(w.qtyPer, 3)} per
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-surface shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<Save size={14} />}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Saving…" : isNew ? "Create BOM" : "Save changes"}
          </Button>
        </div>

        {cloneOpen && bom && variantsInfo && (
          <CloneModal
            sourceLabel={
              bom.variantId
                ? `${bom.variantLabel ?? bom.variantSku}`
                : "product-level default"
            }
            variantsInfo={variantsInfo}
            currentVariantId={bom.variantId ?? null}
            onClose={() => setCloneOpen(false)}
            onConfirm={cloneTo}
            busy={busy}
          />
        )}
      </div>
  );

  if (isPage) return editor;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{editor}</div>
    </div>
  );
};

// ===================================================================
// Variant pill - one button per variant scope on the chip strip.
// Shows a green tick when a variant has its own active BOM, an
// "inherits" hint when it falls back to product-level.
// ===================================================================
const VariantPill = ({
  label,
  sub,
  hint,
  hasBom,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  sub?: string;
  hint?: string;
  hasBom: boolean;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-2.5 py-1 rounded-md border text-left flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap",
        selected
          ? "border-primary bg-primary text-white shadow-e1"
          : hasBom
            ? "border-success bg-success-soft text-success hover:bg-success/10"
            : "border-border bg-white text-ink hover:bg-canvas",
        disabled && !selected && "opacity-70 cursor-not-allowed"
      )}
    >
      {hasBom && !selected && <CheckCircle2 size={11} />}
      <div>
        <div className="text-body-sm font-semibold leading-tight">{label}</div>
        <div
          className={cn(
            "text-caption leading-tight",
            selected ? "opacity-80" : "text-ink-muted"
          )}
        >
          {sub ? `${sub} · ${hint}` : hint}
        </div>
      </div>
    </button>
  );
};

// ===================================================================
// Clone modal - pick one or more target scopes (product-level + each
// variant), then confirm. Targets that already have an active BOM
// are flagged so the user knows they'll be replaced (server-side
// dedupe deactivates the prior active BOM).
// ===================================================================
const CloneModal = ({
  sourceLabel,
  variantsInfo,
  currentVariantId,
  onClose,
  onConfirm,
  busy,
}: {
  sourceLabel: string;
  variantsInfo: VariantsWithBomsRow;
  currentVariantId: string | null;
  onClose: () => void;
  onConfirm: (targets: Array<string | null>) => void;
  busy: boolean;
}) => {
  // null = product-level scope.
  type Scope = string | null;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (s: Scope) => {
    const key = s === null ? "__product__" : s;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const isSelected = (s: Scope) =>
    selected.has(s === null ? "__product__" : s);

  const allTargets: Array<{
    key: Scope;
    label: string;
    sub?: string;
    hasBom: boolean;
    isCurrent: boolean;
  }> = [
    {
      key: null,
      label: "Product-level (default)",
      hasBom: !!variantsInfo.productLevelBom,
      isCurrent: currentVariantId === null,
    },
    ...variantsInfo.variants.map((v) => ({
      key: v.id as Scope,
      label: v.label,
      sub: v.sku,
      hasBom: !!v.activeBom,
      isCurrent: currentVariantId === v.id,
    })),
  ];

  const submitTargets = () => {
    const targets: Scope[] = [];
    if (selected.has("__product__")) targets.push(null);
    for (const v of variantsInfo.variants) {
      if (selected.has(v.id)) targets.push(v.id);
    }
    if (targets.length === 0) return;
    onConfirm(targets);
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-ink/30 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[520px] max-w-[90vw] rounded-lg elevation-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Clone BOM
            </div>
            <div className="text-body-sm">
              From <strong>{sourceLabel}</strong> · pick one or more target scopes
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-3 space-y-1 max-h-[55vh] overflow-y-auto">
          {allTargets.map((t) => {
            const sel = isSelected(t.key);
            const disabled = t.isCurrent;
            return (
              <button
                key={t.key === null ? "__product__" : t.key}
                onClick={() => !disabled && toggle(t.key)}
                disabled={disabled}
                className={cn(
                  "w-full text-left px-3 py-2 border rounded-md flex items-center gap-2",
                  sel
                    ? "border-primary bg-primary-50"
                    : "border-border hover:bg-canvas",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <input
                  type="checkbox"
                  checked={sel}
                  readOnly
                  disabled={disabled}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-body-sm font-semibold">
                    {t.label}{" "}
                    {t.sub && (
                      <span className="font-mono text-caption text-ink-muted">
                        · {t.sub}
                      </span>
                    )}
                  </div>
                  <div className="text-caption text-ink-muted">
                    {t.isCurrent
                      ? "this is the source - cannot clone onto itself"
                      : t.hasBom
                        ? "already has an active BOM - will be deactivated"
                        : "no BOM yet - clone becomes the new active BOM"}
                  </div>
                </div>
                {t.hasBom && !t.isCurrent && (
                  <Chip size="sm" tone="warning">
                    will replace
                  </Chip>
                )}
              </button>
            );
          })}
        </div>
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<Copy size={14} />}
            onClick={submitTargets}
            disabled={busy || selected.size === 0}
          >
            {busy ? "Cloning…" : `Clone to ${selected.size} target${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ===================================================================
// Component row: editable, with drill-in for sub-assemblies.
// ===================================================================
const ComponentRow = ({
  item,
  products,
  isPickerOpen,
  onPickerOpen,
  onPickerClose,
  onPick,
  onPatch,
  onRemove,
  onDrillIn,
}: {
  item: EditableItem;
  products: Product[];
  isPickerOpen: boolean;
  onPickerOpen: () => void;
  onPickerClose: () => void;
  onPick: (productId: string) => void;
  onPatch: (patch: Partial<EditableItem>) => void;
  onRemove: () => void;
  onDrillIn: () => void;
}) => {
  const [search, setSearch] = useState("");
  const { sameCategory, convert } = useUoms();
  // Component product (parent of this BOM line) and its stock UoM. The
  // conversion hint shows "100 g (= 0.1 kg consumed)" so authors can
  // confidently mix g/kg or mL/L without second-guessing the math.
  const componentProductUom = item.productId
    ? products.find((p) => p.id === item.productId)?.uom
    : undefined;
  let conversionHint: string | null = null;
  if (
    componentProductUom &&
    item.uom &&
    item.uom !== componentProductUom &&
    sameCategory(item.uom, componentProductUom) &&
    item.qty > 0
  ) {
    try {
      const inStockUom = convert(item.qty, item.uom, componentProductUom);
      conversionHint = `= ${num(inStockUom, 3)} ${componentProductUom} consumed`;
    } catch {
      conversionHint = null;
    }
  }
  const conversionWarn =
    componentProductUom &&
    item.uom &&
    item.uom !== componentProductUom &&
    !sameCategory(item.uom, componentProductUom);
  return (
    <div className="px-3 py-2 hover:bg-canvas/50">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-5 min-w-0">
          {item.productId ? (
            <button
              onClick={onPickerOpen}
              className="text-left w-full p-1 rounded hover:bg-canvas"
            >
              <div className="font-mono text-caption text-primary">{item.sku}</div>
              <div className="text-body-sm font-semibold truncate">{item.name}</div>
            </button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={<Search size={14} />}
              onClick={onPickerOpen}
            >
              Choose product
            </Button>
          )}
        </div>
        <div className="col-span-2">
          <Input
            size="sm"
            type="number"
            step={0.001}
            min={0}
            value={item.qty}
            onChange={(e) => onPatch({ qty: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="col-span-1">
          {/* UoM constrained to the component product's category so
              you can pick e.g. kg/g/mg for a weight-based component
              but not accidentally choose litres. */}
          <UomPicker
            size="sm"
            className="w-full"
            value={item.uom}
            onChange={(uom) => onPatch({ uom })}
            categoryOfCode={
              products.find((p) => p.id === item.productId)?.uom ?? item.uom
            }
          />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-1">
            <Input
              size="sm"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={item.scrapPct}
              onChange={(e) =>
                onPatch({ scrapPct: Number(e.target.value) || 0 })
              }
            />
            <span className="text-caption text-ink-muted">%</span>
          </div>
        </div>
        <div className="col-span-2 flex items-center justify-end gap-1">
          {item.hasSubAssembly && (
            <button
              onClick={onDrillIn}
              title="Drill into sub-assembly BOM"
              className="h-7 w-7 grid place-items-center rounded text-primary hover:bg-primary-50"
            >
              <Layers size={14} />
            </button>
          )}
          <button
            onClick={onRemove}
            title="Remove component"
            className="h-7 w-7 grid place-items-center rounded text-danger hover:bg-danger-soft"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {item.hasSubAssembly && (
        <div className="text-caption text-primary mt-1 ml-1 flex items-center gap-1">
          <Network size={10} /> Sub-assembly · click <Layers size={10} /> to drill in
        </div>
      )}
      {conversionHint && (
        <div className="text-caption text-ink-muted mt-1 ml-1">
          <span className="font-mono">{num(item.qty, 3)} {item.uom}</span>{" "}
          <span className="text-primary">{conversionHint}</span>
        </div>
      )}
      {conversionWarn && (
        <div className="text-caption text-danger mt-1 ml-1">
          UoM "{item.uom}" cannot be converted to component's stock UoM "{componentProductUom}". Pick a UoM in the same category.
        </div>
      )}
      {isPickerOpen && (
        <div className="mt-2 p-2 border border-border rounded-md bg-canvas">
          <Input
            size="sm"
            autoFocus
            iconLeft={<Search size={14} />}
            placeholder="Search to swap product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ProductPickList
            products={products}
            search={search}
            onPick={(p) => {
              onPick(p.id);
              setSearch("");
            }}
            excludeId={item.productId}
          />
          <div className="mt-1 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onPickerClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ===================================================================
// Tree node renderer (right-pane preview).
// ===================================================================
const TreeNodeView = ({
  node,
  depth,
  parentProduct,
}: {
  node: BomTreeNode;
  depth: number;
  // The product the BomEditor is rooted at. Lets the root node display
  // the variant's effective UoM when this BOM is variant-scoped, and
  // disambiguates the "ALMN Almonds" line that appears twice (once as
  // the produced variant, once as the consumed parent) in a packaging
  // BOM. Null at deeper depths or when the editor hasn't loaded yet.
  parentProduct: Product | null;
}) => {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  // Resolve display SKU + name + qty UoM for this node. The root node
  // of a variant-scoped BOM gets the variant's identity so the user
  // tells the produced variant apart from any same-productId
  // component below it. Other nodes display the product as before.
  let displaySku = node.sku;
  let displayName = node.name;
  let displayUom = node.uom;
  let scopeChip: string | null = null;
  if (depth === 0 && node.variantSku) {
    displaySku = node.variantSku;
    displayName = node.variantLabel ?? node.name;
    const v = parentProduct?.variants?.find((x) => x.sku === node.variantSku);
    const vUom = (v?.uom ?? "").trim();
    if (vUom) displayUom = vUom;
    scopeChip = "variant";
  } else if (depth === 0) {
    scopeChip = "product-level";
  }

  // For component lines whose BOM author chose a UoM different from
  // the product's stock UoM (e.g. wrote "100 g" against a kg-tracked
  // component), show both - the as-authored qty and the converted
  // qty in stock UoM. This mirrors the inline hint on the editor row.
  const showAuthoredHint =
    depth > 0 &&
    typeof node.bomUom === "string" &&
    typeof node.bomQty === "number" &&
    node.bomUom !== node.uom;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 text-body-sm",
          depth === 0 && "font-semibold"
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="h-5 w-5 grid place-items-center text-ink-muted hover:text-ink"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span className="font-mono text-caption text-primary truncate min-w-0">
          {displaySku}
        </span>
        <span className="truncate min-w-0 flex-1">{displayName}</span>
        {scopeChip && (
          <Chip size="sm" tone={scopeChip === "variant" ? "primary" : "neutral"}>
            {scopeChip}
          </Chip>
        )}
        {node.cycle && (
          <Chip size="sm" tone="danger">
            cycle
          </Chip>
        )}
        {node.bomId && depth > 0 && (
          <Chip size="sm" tone="primary">
            <Boxes size={10} className="mr-1" /> sub
          </Chip>
        )}
        <span className="text-caption text-ink-muted tnum w-32 text-right shrink-0">
          {num(node.effectiveQty, 3)} {displayUom}
        </span>
      </div>
      {showAuthoredHint && (
        <div
          className="text-caption text-ink-muted tnum"
          style={{ paddingLeft: `${depth * 14 + 28}px` }}
        >
          authored: {num(node.bomQty ?? 0, 3)} {node.bomUom}
        </div>
      )}
      {open && hasChildren && (
        <div>
          {node.children.map((c, i) => (
            <TreeNodeView
              key={`${c.productId}-${i}`}
              node={c}
              depth={depth + 1}
              parentProduct={parentProduct}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ===================================================================
// Tiny product search list (filtered, capped at 30).
// ===================================================================
const ProductPickList = ({
  products,
  search,
  onPick,
  excludeId,
  excludeIds = [],
  fillHeight,
}: {
  products: Product[];
  search: string;
  onPick: (p: Product) => void;
  excludeId?: string;
  excludeIds?: string[];
  // When true, the list expands to fill its parent's height (used
  // in the inline component picker). When false (legacy mode in
  // ComponentRow), we cap with max-h-48 so the list doesn't push
  // surrounding rows off-screen.
  fillHeight?: boolean;
}) => {
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return products
      .filter((p) => p.id !== excludeId && !excludeIds.includes(p.id))
      .filter((p) =>
        q
          ? p.sku.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q)
          : true
      )
      .slice(0, fillHeight ? 200 : 30);
  }, [products, q, excludeId, excludeIds, fillHeight]);
  return (
    <div
      className={cn(
        "overflow-y-auto border border-border rounded-md bg-white",
        fillHeight ? "h-full" : "mt-1 max-h-48"
      )}
    >
      {filtered.length === 0 ? (
        <div className="p-3 text-caption text-ink-muted text-center">
          No matching products.
        </div>
      ) : (
        filtered.map((p) => {
          const tone =
            p.type === "finished"
              ? "success"
              : p.type === "semi"
                ? "primary"
                : p.type === "raw"
                  ? "neutral"
                  : "warning";
          return (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              className="w-full text-left px-2.5 py-1.5 hover:bg-canvas border-b border-border/60 last:border-0 flex items-center gap-2"
            >
              <Chip size="sm" tone={tone} className="capitalize w-16 justify-center">
                {p.type}
              </Chip>
              <span className="font-mono text-caption text-primary w-24 truncate">
                {p.sku}
              </span>
              <span className="text-body-sm truncate flex-1">{p.name}</span>
              <span className="text-caption text-ink-muted">
                {p.uom}
              </span>
              {p.type === "semi" && (
                <CheckCircle2 size={12} className="text-primary" />
              )}
            </button>
          );
        })
      )}
    </div>
  );
};
