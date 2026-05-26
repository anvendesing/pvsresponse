import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, RefreshCw, ScanBarcode, AlertTriangle } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";

// =====================================================================
// /warehouse-audit
// =====================================================================
// Supervisor-only desktop view that surfaces:
//   - flagged BinCount rows (variance > 10% or > 50 units)
//   - recent ScanEvent rows with outcome != "ok"
// Both feed straight off the new mobile-warehouse endpoints. No
// charting yet - that's Phase 1.5; this page is the immediate audit
// hook for managers reviewing what their floor workers did.

interface BinCountRow {
  id: string;
  qtyBefore: number;
  qtyAfter: number;
  delta: number;
  reason: string;
  remarks?: string | null;
  flagged: boolean;
  createdAt: string;
  bin?: {
    id: string;
    code?: string | null;
    zone: string;
    rack: string;
    shelf: string;
    bin: string;
    warehouse?: { code: string; name: string };
  };
  countedBy?: { id: string; name: string; username: string };
  productIdBefore?: string | null;
  productIdAfter?: string | null;
}

interface ScanEventRow {
  id: string;
  kind: string;
  code: string;
  context?: string | null;
  outcome: string;
  createdAt: string;
  user?: { id: string; name: string; username: string };
}

const REASON_LABELS: Record<string, string> = {
  physical_match: "Physical match",
  damage: "Damage",
  found_elsewhere: "Found elsewhere",
  product_swap: "Product swap",
  spillage: "Spillage",
  expired: "Expired",
  other: "Other",
};

const OUTCOME_LABELS: Record<string, string> = {
  ok: "OK",
  mismatch: "Mismatch",
  not_found: "Not found",
};

export const WarehouseAudit = () => {
  const [tab, setTab] = useState<"variance" | "scans">("variance");
  const [variance, setVariance] = useState<BinCountRow[]>([]);
  const [scans, setScans] = useState<ScanEventRow[]>([]);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [vRows, sRows] = await Promise.all([
        api.binCounts(showFlaggedOnly ? { flagged: "1", limit: 200 } : { limit: 200 }),
        api.scanEvents({ limit: 200 }),
      ]);
      setVariance(vRows as unknown as BinCountRow[]);
      setScans(sRows as unknown as ScanEventRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [showFlaggedOnly]);

  const mismatches = useMemo(
    () => scans.filter((s) => s.outcome !== "ok"),
    [scans]
  );

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <h2 className="text-h3 font-bold flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-600" />
            Warehouse audit
          </h2>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              icon={<RefreshCw size={14} />}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 rounded-md bg-canvas p-1 w-fit">
          <button
            onClick={() => setTab("variance")}
            className={[
              "px-3 py-1.5 text-body-sm rounded-md font-medium transition",
              tab === "variance"
                ? "bg-white shadow-sm text-primary"
                : "text-ink-muted",
            ].join(" ")}
          >
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle size={14} /> Variance ({variance.length})
            </span>
          </button>
          <button
            onClick={() => setTab("scans")}
            className={[
              "px-3 py-1.5 text-body-sm rounded-md font-medium transition",
              tab === "scans"
                ? "bg-white shadow-sm text-primary"
                : "text-ink-muted",
            ].join(" ")}
          >
            <span className="inline-flex items-center gap-1.5">
              <ScanBarcode size={14} /> Scan events ({mismatches.length} flagged)
            </span>
          </button>
        </div>

        {tab === "variance" && (
          <>
            <div className="flex items-center gap-3 text-body-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showFlaggedOnly}
                  onChange={(e) => setShowFlaggedOnly(e.target.checked)}
                />
                <span>Show flagged only</span>
              </label>
              <span className="text-ink-muted">
                Variance is auto-flagged when |delta| &gt; 10% of previous qty or
                &gt; 50 units, OR on a product swap.
              </span>
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="min-w-full text-body-sm">
                  <thead>
                    <tr className="text-left text-caption uppercase tracking-wider text-ink-muted border-b border-border">
                      <th className="grid-header-cell">When</th>
                      <th className="grid-header-cell">Bin</th>
                      <th className="grid-header-cell">Qty before → after</th>
                      <th className="grid-header-cell">Delta</th>
                      <th className="grid-header-cell">Reason</th>
                      <th className="grid-header-cell">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variance.length === 0 && !loading && (
                      <tr>
                        <td colSpan={6} className="grid-cell text-center text-ink-muted">
                          {showFlaggedOnly
                            ? "No flagged variances. Floor counts look clean."
                            : "No cycle counts on file yet."}
                        </td>
                      </tr>
                    )}
                    {variance.map((v) => (
                      <tr
                        key={v.id}
                        className={[
                          "border-b border-border/60",
                          v.flagged ? "bg-amber-50/50" : "",
                        ].join(" ")}
                      >
                        <td className="grid-cell font-mono text-[12px]">
                          {new Date(v.createdAt).toLocaleString()}
                        </td>
                        <td className="grid-cell font-mono text-[12px]">
                          {v.bin?.code ??
                            `${v.bin?.warehouse?.code ?? "?"} · ${v.bin?.zone}/${v.bin?.rack}/${v.bin?.shelf}/${v.bin?.bin}`}
                        </td>
                        <td className="grid-cell tnum">
                          {v.qtyBefore} → {v.qtyAfter}
                        </td>
                        <td
                          className={[
                            "grid-cell tnum font-semibold",
                            v.delta > 0
                              ? "text-emerald-700"
                              : v.delta < 0
                              ? "text-red-700"
                              : "text-ink-muted",
                          ].join(" ")}
                        >
                          {v.delta >= 0 ? "+" : ""}
                          {v.delta}
                          {v.flagged && (
                            <span className="ml-2 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                              flagged
                            </span>
                          )}
                          {v.productIdBefore &&
                            v.productIdAfter &&
                            v.productIdBefore !== v.productIdAfter && (
                              <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                                product swap
                              </span>
                            )}
                        </td>
                        <td className="grid-cell">
                          <div>{REASON_LABELS[v.reason] ?? v.reason}</div>
                          {v.remarks && (
                            <div className="text-[11px] text-ink-muted italic">
                              "{v.remarks}"
                            </div>
                          )}
                        </td>
                        <td className="grid-cell">{v.countedBy?.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "scans" && (
          <>
            <div className="text-body-sm text-ink-muted">
              Every barcode read from the mobile PWA is logged here. Filter on
              "mismatch" or "not_found" to spot misprinted labels or worn
              tags.
            </div>
            <Card>
              <div className="overflow-x-auto">
                <table className="min-w-full text-body-sm">
                  <thead>
                    <tr className="text-left text-caption uppercase tracking-wider text-ink-muted border-b border-border">
                      <th className="grid-header-cell">When</th>
                      <th className="grid-header-cell">Kind</th>
                      <th className="grid-header-cell">Code</th>
                      <th className="grid-header-cell">Context</th>
                      <th className="grid-header-cell">Outcome</th>
                      <th className="grid-header-cell">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.length === 0 && !loading && (
                      <tr>
                        <td colSpan={6} className="grid-cell text-center text-ink-muted">
                          No scan events on file yet.
                        </td>
                      </tr>
                    )}
                    {scans.map((s) => (
                      <tr
                        key={s.id}
                        className={[
                          "border-b border-border/60",
                          s.outcome !== "ok" ? "bg-amber-50/40" : "",
                        ].join(" ")}
                      >
                        <td className="grid-cell font-mono text-[12px]">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td className="grid-cell capitalize">{s.kind}</td>
                        <td className="grid-cell font-mono text-[12px]">{s.code}</td>
                        <td className="grid-cell text-[12px]">{s.context ?? "—"}</td>
                        <td className="grid-cell">
                          <span
                            className={[
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              s.outcome === "ok"
                                ? "bg-emerald-100 text-emerald-700"
                                : s.outcome === "mismatch"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-700",
                            ].join(" ")}
                          >
                            {OUTCOME_LABELS[s.outcome] ?? s.outcome}
                          </span>
                        </td>
                        <td className="grid-cell">{s.user?.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
