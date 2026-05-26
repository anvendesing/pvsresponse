import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

// =====================================================================
// /m/verify
// =====================================================================
// Quick-glance "stock verification" landing page. Two affordances:
//   1. Recent flagged cycle counts (live audit feed for any worker who
//      wants to spot anomalies in their zone).
//   2. Big "scan a label" CTA that hops to /m/scan.
//
// We deliberately keep it light - the meaty cycle-count action lives
// inside MobileBin, which is reachable via scan or via the Tasks tab.

interface BinCountRow {
  id: string;
  qtyBefore: number;
  qtyAfter: number;
  delta: number;
  reason: string;
  flagged: boolean;
  createdAt: string;
  bin?: {
    id: string;
    code?: string | null;
    zone: string;
    rack: string;
    shelf: string;
    bin: string;
    warehouse?: { code: string };
  };
  countedBy?: { name?: string };
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

export const MobileVerify = () => {
  const [rows, setRows] = useState<BinCountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"recent" | "flagged">("flagged");

  const load = async () => {
    setLoading(true);
    try {
      const res = (await api.binCounts(
        tab === "flagged" ? { flagged: "1", limit: 30 } : { limit: 30 }
      )) as unknown as BinCountRow[];
      setRows(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [tab]);

  return (
    <div className="px-4 pt-4">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Verify stock</h2>
        <p className="mt-1 text-sm text-slate-500">
          Scan any bin or product label to check its current count or post a
          correction.
        </p>
        <Link
          to="/m/scan"
          className="mt-3 block rounded-xl bg-[#003087] py-3 text-center text-sm font-semibold text-white"
        >
          Scan a label
        </Link>
      </div>

      <div className="mb-3 flex rounded-2xl bg-slate-200 p-1">
        <button
          type="button"
          onClick={() => setTab("flagged")}
          className={[
            "flex-1 rounded-xl py-2 text-sm font-semibold transition",
            tab === "flagged" ? "bg-white text-amber-700 shadow-sm" : "text-slate-600",
          ].join(" ")}
        >
          Flagged ({rows.filter((r) => r.flagged).length})
        </button>
        <button
          type="button"
          onClick={() => setTab("recent")}
          className={[
            "flex-1 rounded-xl py-2 text-sm font-semibold transition",
            tab === "recent" ? "bg-white text-[#003087] shadow-sm" : "text-slate-600",
          ].join(" ")}
        >
          Recent
        </button>
      </div>

      <div className="space-y-2 pb-4">
        {rows.length === 0 && !loading && (
          <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            {tab === "flagged"
              ? "No flagged variances. Looking good."
              : "No recent counts on file."}
          </div>
        )}
        {rows.map((r) => (
          <Link
            key={r.id}
            to={r.bin?.id ? `/m/bin/${r.bin.id}` : "/m/scan"}
            className={[
              "block rounded-xl px-4 py-3 ring-1",
              r.flagged ? "bg-amber-50 ring-amber-200" : "bg-white ring-slate-200",
            ].join(" ")}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs text-slate-500">
                {r.bin?.code ??
                  `${r.bin?.warehouse?.code ?? ""} ${r.bin?.zone}/${r.bin?.rack}/${r.bin?.shelf}/${r.bin?.bin}`}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-0.5 text-sm">
              {r.qtyBefore} → {r.qtyAfter}
              <span
                className={[
                  "ml-1 font-semibold",
                  r.delta >= 0 ? "text-emerald-700" : "text-red-700",
                ].join(" ")}
              >
                ({r.delta >= 0 ? "+" : ""}
                {r.delta})
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {REASON_LABELS[r.reason] ?? r.reason} · {r.countedBy?.name ?? "—"}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};
