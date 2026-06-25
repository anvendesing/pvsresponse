/**
 * Parse Tally JIT production planning export and derive MO stock-rule inputs.
 */
export type TallyJitRow = {
  rank: number;
  tallyName: string;
  erpName: string;
  variantSku: string;
  matchStatus: string;
  totalSold: number;
  ordersCount: number;
  avgDailySales: number;
  peakDailySales: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedBatch: number;
  maxQty: number;
  currentErpStock: number;
};

export type ParsedTallyJitPlan = {
  rows: TallyJitRow[];
  unmatched: number;
  matched: number;
};

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

export function parseTallyJitSheet(rows: Record<string, unknown>[]): ParsedTallyJitPlan {
  const out: TallyJitRow[] = [];
  let unmatched = 0;
  let matched = 0;

  for (const raw of rows) {
    const matchStatus = String(raw["Match Status"] ?? "").trim();
    const variantSku = String(raw["SKU / Match"] ?? "").trim();
    if (!variantSku) continue;

    if (matchStatus === "Matched") matched += 1;
    else unmatched += 1;

    if (matchStatus !== "Matched") continue;

    out.push({
      rank: num(raw["Rank"]),
      tallyName: String(raw["Tally Item Name"] ?? "").trim(),
      erpName: String(raw["ERP Mapped Name"] ?? "").trim(),
      variantSku,
      matchStatus,
      totalSold: num(raw["Total Sold (Units)"]),
      ordersCount: num(raw["Orders Count"]),
      avgDailySales: num(raw["Avg Daily Sales"]),
      peakDailySales: num(raw["Peak Daily Sales"]),
      leadTimeDays: num(raw["Lead Time (Days)"], 1),
      safetyStock: num(raw["Safety Stock / Min Qty"]),
      reorderPoint: num(raw["Reorder Point (ROP)"]),
      suggestedBatch: num(raw["Suggested Batch Size"]),
      maxQty: num(raw["Max Qty"]),
      currentErpStock: num(raw["Current ERP Stock"]),
    });
  }

  return { rows: out, unmatched, matched };
}

/** Reorder point — trigger replenishment when stock falls below this level. */
export function reorderPointFromTally(row: TallyJitRow): number {
  const rop = Math.ceil(row.reorderPoint);
  if (rop > 0) return rop;
  const safety = Math.ceil(row.safetyStock);
  const leadDemand = Math.ceil(row.avgDailySales * Math.max(1, row.leadTimeDays));
  return Math.max(1, safety + leadDemand);
}

/** Target stock level after replenishment (order up to Max Qty). */
export function reorderTargetFromTally(row: TallyJitRow): number {
  const max = Math.ceil(row.maxQty);
  if (max > 0) return max;
  const rop = reorderPointFromTally(row);
  const batch = Math.ceil(row.suggestedBatch);
  return Math.max(rop + 1, batch > 0 ? rop + batch : rop * 2);
}

/** @deprecated Use reorderPointFromTally */
export function moMinQtyFromTally(row: TallyJitRow): number {
  return reorderPointFromTally(row);
}
