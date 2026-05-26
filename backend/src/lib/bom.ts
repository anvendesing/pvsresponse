// Multi-level BOM utilities, variant-aware.
//
// A BOM describes how one parent (product, variant?) is built from a
// list of component products. Each component in turn may have its own
// active BOM (a sub-assembly) - this is what "multi-level" means.
//
// Variant support:
//   * A BOM may be tied to a specific ProductVariant (e.g. "Coconut
//     Oil 5L" needing a different bottle, cap, carton from "Coconut
//     Oil 1L"), or it may be a *product-level* BOM (variantId=null)
//     used as the default for any variant that doesn't have its own.
//   * Lookup precedence: variant-specific first, fall back to
//     product-level. If neither exists, the product is a leaf at
//     that level.
//
// Three operations matter for production planning:
//
//   1. explode(productId, qty, opts)
//      Walk the tree all the way to leaves (products without an
//      active BOM) and return an aggregated list of raw materials
//      needed. Quantities multiply down the tree and scrap % is
//      compounded along the way.
//
//   2. tree(productId, qty, opts)
//      Same walk, but keep the nested structure for UI display.
//
//   3. whereUsed(productId)
//      Reverse lookup: which parent BOMs consume this product? Used
//      by the BOM editor to warn before deleting / changing a part.
//
// All walks defend against cycles by tracking the path from root.
// Self-references and longer cycles (A->B->A) raise an error so a
// bad BOM definition can never crash a planning run.

import { db } from "../db.js";
import { UOMS, convertUom } from "./uom.js";

// ----------------------------------------------------------------
// Types

export interface BomLeaf {
  productId: string;
  sku: string;
  name: string;
  // Component's stock UoM (= product.uom). All leaf qtys are returned
  // in this unit so the issuer can decrement bin.qty / stockOnHand
  // directly without further conversion.
  uom: string;
  // Total quantity needed at the leaf, in the leaf's stock UoM. Already
  // multiplied through every level, inflated by scrap %, and converted
  // from the BOM-specified UoM into the product's stock UoM.
  qty: number;
  // Original UoM the BOM author wrote on the BomItem row (e.g. "g") and
  // the qty in that UoM, before conversion. Useful for human-readable
  // explanations like "100 g of vitamin E premix = 0.1 kg consumed".
  bomUom: string;
  bomQty: number;
  // The lineage of products from the top of the tree to this leaf,
  // useful for tooltips like "Pump A2 -> Pump body -> M8 bolt".
  path: string[];
}

// Convert a BOM component qty into the component's stock UoM.
// Returns { qty, sourceUom, targetUom }. Throws a useful 400-style
// error if the codes are unknown or live in different categories.
const toStockUom = (
  componentUom: string,
  componentQty: number,
  productUom: string,
  productSku: string
): number => {
  if (componentUom === productUom) return componentQty;
  try {
    return convertUom(componentQty, componentUom, productUom, UOMS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(
      new Error(
        `BOM component "${productSku}" specifies qty in "${componentUom}" but the product is stocked in "${productUom}". ${msg}. Edit the BOM to use a UoM in the same category, or change the product's stock UoM.`
      ),
      { statusCode: 400, code: "bom_uom_incompatible" }
    );
  }
};

export interface BomNode {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  type: string;
  // Which variant this node is rendered as (root only - sub
  // assemblies are resolved at the product level for now).
  variantId: string | null;
  variantSku?: string;
  variantLabel?: string;
  // Quantity needed at this level (per-parent, before being multiplied
  // for the parent's plan). Zero at the root. Already in stock UoM.
  qty: number;
  // The author-chosen UoM and qty for this BOM line (pre-conversion).
  // Lets the UI render "100 g (= 0.1 kg)".
  bomUom: string;
  bomQty: number;
  scrapPct: number;
  // The product's own active BOM (if any) - this drives the recursion.
  // `null` means "leaf"; `cycle` means we hit a loop and stopped.
  bomId: string | null;
  // Effective demand for the planned parent quantity. Carries the
  // multiplicative chain through levels. Always in stock UoM.
  effectiveQty: number;
  children: BomNode[];
  cycle?: boolean;
}

// ----------------------------------------------------------------
// Internal: cached BOM lookup so we don't fan out N queries when one
// component appears under many parents.

interface CachedBom {
  id: string;
  outputQty: number;
  variantId: string | null;
  variant?: { sku: string; size: string | null } | null;
  items: Array<{
    productId: string;
    // Quantity in the BOM-specified UoM (whatever the BOM author chose
    // to author with, e.g. "100 g" of vitamin E premix).
    qty: number;
    uom: string;
    scrapPct: number;
    // Product is fetched with its stock UoM so the walker can convert
    // BomItem.qty (in BomItem.uom) into the canonical stock unit.
    product: { sku: string; name: string; uom: string; type: string };
  }>;
}

// Fetch the active BOM for (productId, variantId) with product-level
// fallback. Variant lookup precedence:
//   1. Exact variant match (variantId set, matches).
//   2. Product-level BOM (variantId is null).
// Returns null if neither exists.
const fetchActiveBomFor = async (
  productId: string,
  variantId: string | null,
  cache: Map<string, CachedBom | null>
): Promise<CachedBom | null> => {
  // Cache key combines both - product-only and variant-specific BOMs
  // need separate cache entries.
  const key = `${productId}::${variantId ?? ""}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  if (variantId) {
    const variantBom = await db.bom.findFirst({
      where: { productId, variantId, active: true },
      include: {
        variant: { select: { sku: true, size: true } },
        items: {
          include: {
            product: { select: { sku: true, name: true, uom: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (variantBom) {
      cache.set(key, variantBom);
      return variantBom;
    }
  }

  // Fall back to product-level (no variant) BOM.
  const productBom = await db.bom.findFirst({
    where: { productId, variantId: null, active: true },
    include: {
      variant: { select: { sku: true, size: true } },
      items: {
        include: {
          product: { select: { sku: true, name: true, uom: true, type: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  cache.set(key, productBom);
  return productBom;
};

// ----------------------------------------------------------------
// Tree walk - returns nested structure.

export interface BomWalkOpts {
  // Variant of the *root* product to produce. Null = product-level.
  variantId?: string | null;
}

export const bomTree = async (
  rootProductId: string,
  qty: number = 1,
  opts: BomWalkOpts = {}
): Promise<BomNode> => {
  const cache = new Map<string, CachedBom | null>();
  const root = await db.product.findUnique({
    where: { id: rootProductId },
    select: { id: true, sku: true, name: true, uom: true, type: true },
  });
  if (!root) {
    throw new Error(`Product not found: ${rootProductId}`);
  }
  const rootVariantId = opts.variantId ?? null;
  const rootBom = await fetchActiveBomFor(rootProductId, rootVariantId, cache);
  let rootVariant: { sku: string; size: string | null } | null = null;
  if (rootVariantId) {
    rootVariant = await db.productVariant.findUnique({
      where: { id: rootVariantId },
      select: { sku: true, size: true },
    });
  }

  // Sub-assemblies are looked up by productId only (variantId=null)
  // for now - i.e. a sub-assembly's own variant resolution is not
  // propagated into the parent walk. This keeps the walker tractable
  // and matches how most users author BOMs (sub-assembly variants
  // are themselves modelled as separate products like
  // "Filled bottle 1L" vs "Filled bottle 5L").
  const walk = async (
    productId: string,
    info: { sku: string; name: string; uom: string; type: string },
    perParentQty: number,
    bomUom: string,
    bomQty: number,
    scrapPct: number,
    parentEffective: number,
    visited: Set<string>
  ): Promise<BomNode> => {
    const inflate = 1 + (scrapPct ?? 0) / 100;
    const effectiveQty = parentEffective * perParentQty * inflate;
    const node: BomNode = {
      productId,
      sku: info.sku,
      name: info.name,
      uom: info.uom,
      type: info.type,
      variantId: null,
      qty: perParentQty,
      bomUom,
      bomQty,
      scrapPct,
      bomId: null,
      effectiveQty,
      children: [],
    };
    if (visited.has(productId)) {
      node.cycle = true;
      return node;
    }
    const sub = await fetchActiveBomFor(productId, null, cache);
    if (!sub) return node;
    node.bomId = sub.id;
    const nextVisited = new Set(visited);
    nextVisited.add(productId);
    const outputDivisor = sub.outputQty > 0 ? sub.outputQty : 1;
    for (const item of sub.items) {
      // Convert BomItem.qty (in BomItem.uom) into the child product's
      // stock UoM. Per-parent demand is then `converted / outputDivisor`.
      const convertedQty = toStockUom(
        item.uom,
        item.qty,
        item.product.uom,
        item.product.sku
      );
      const child = await walk(
        item.productId,
        item.product,
        convertedQty / outputDivisor,
        item.uom,
        item.qty,
        item.scrapPct,
        effectiveQty,
        nextVisited
      );
      node.children.push(child);
    }
    return node;
  };

  // Synthesise a "root" node so we can reuse the recursive walker.
  const rootNode: BomNode = {
    productId: root.id,
    sku: root.sku,
    name: root.name,
    uom: root.uom,
    type: root.type,
    variantId: rootVariantId,
    variantSku: rootVariant?.sku,
    variantLabel: rootVariant?.size ?? rootVariant?.sku,
    qty: 1,
    bomUom: root.uom,
    bomQty: 1,
    scrapPct: 0,
    bomId: rootBom?.id ?? null,
    effectiveQty: qty,
    children: [],
  };
  if (!rootBom) return rootNode;
  // Cycle protection: only seed visited with the root product when the
  // BOM is product-level. For variant-scoped BOMs, the variant being
  // produced (e.g. "BKRC-1KG-01") and the parent product being consumed
  // (e.g. bulk "BKRC" in kg) are different stock entities, so a
  // variant BOM is allowed to list its parent product as a component
  // (the standard "packaging BOM" pattern). True cycles like
  // (parent BOM) -> consumes parent are still detected because the
  // recursive walker adds productId to visited before stepping into a
  // sub-assembly.
  const visited = new Set<string>(rootVariantId ? [] : [root.id]);
  const outputDivisor = rootBom.outputQty > 0 ? rootBom.outputQty : 1;
  for (const item of rootBom.items) {
    const convertedQty = toStockUom(
      item.uom,
      item.qty,
      item.product.uom,
      item.product.sku
    );
    const child = await walk(
      item.productId,
      item.product,
      convertedQty / outputDivisor,
      item.uom,
      item.qty,
      item.scrapPct,
      qty,
      visited
    );
    rootNode.children.push(child);
  }
  return rootNode;
};

// ----------------------------------------------------------------
// Flat explosion - aggregated leaves only.

export const explodeBom = async (
  rootProductId: string,
  qty: number = 1,
  opts: BomWalkOpts = {}
): Promise<BomLeaf[]> => {
  const tree = await bomTree(rootProductId, qty, opts);
  const leaves = new Map<string, BomLeaf>();
  const walk = (n: BomNode, path: string[]) => {
    if (n.cycle) return;
    const isLeaf = n.children.length === 0;
    if (isLeaf && path.length > 0) {
      const existing = leaves.get(n.productId);
      if (existing) {
        // Aggregate in stock UoM. The bomUom/bomQty fields capture
        // ONE representative line for display only - if the same
        // product is consumed via multiple paths the aggregate qty
        // is still correct, just attributed to the first path's
        // author UoM. Add a recompute for the bomQty in the source
        // unit so the "as-authored" hint stays meaningful.
        existing.qty += n.effectiveQty;
        if (existing.bomUom === n.bomUom) {
          // Same authored UoM across paths - safe to sum.
          existing.bomQty = totalAuthoredFromStock(existing.qty, n.uom, n.bomUom, n.sku);
        }
      } else {
        leaves.set(n.productId, {
          productId: n.productId,
          sku: n.sku,
          name: n.name,
          uom: n.uom,
          qty: n.effectiveQty,
          bomUom: n.bomUom,
          bomQty: totalAuthoredFromStock(n.effectiveQty, n.uom, n.bomUom, n.sku),
          path: [...path],
        });
      }
      return;
    }
    for (const c of n.children) walk(c, [...path, n.sku]);
  };
  walk(tree, []);
  return Array.from(leaves.values()).sort((a, b) => a.sku.localeCompare(b.sku));
};

// Reverse the stock-UoM total back into the originally authored UoM
// for display ("you wrote it in g, here's how many g this batch needs").
// Best-effort: if the conversion fails (mixed-category, shouldn't
// happen because we already converted forward) we just return the
// stock qty as-is.
const totalAuthoredFromStock = (
  stockQty: number,
  stockUom: string,
  authoredUom: string,
  sku: string
): number => {
  if (stockUom === authoredUom) return stockQty;
  try {
    return convertUom(stockQty, stockUom, authoredUom, UOMS);
  } catch {
    // Defensive: shouldn't happen because forward conversion succeeded.
    void sku;
    return stockQty;
  }
};

// ----------------------------------------------------------------
// Reverse lookup: which BOMs consume this product?

export interface WhereUsedRow {
  bomId: string;
  parentProductId: string;
  parentSku: string;
  parentName: string;
  // Variant scope of the parent BOM, if any.
  parentVariantId: string | null;
  parentVariantSku: string | null;
  parentVariantLabel: string | null;
  qtyPer: number;
  scrapPct: number;
}

export const whereUsed = async (productId: string): Promise<WhereUsedRow[]> => {
  const items = await db.bomItem.findMany({
    where: { productId },
    include: {
      bom: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
          variant: { select: { id: true, sku: true, size: true } },
        },
      },
    },
  });
  return items.map((i) => ({
    bomId: i.bomId,
    parentProductId: i.bom.product.id,
    parentSku: i.bom.product.sku,
    parentName: i.bom.product.name,
    parentVariantId: i.bom.variant?.id ?? null,
    parentVariantSku: i.bom.variant?.sku ?? null,
    parentVariantLabel: i.bom.variant?.size ?? i.bom.variant?.sku ?? null,
    qtyPer: i.qty,
    scrapPct: i.scrapPct,
  }));
};
