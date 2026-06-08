import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";

// =====================================================================
// /m/loc/:code
// =====================================================================
// Renders the right "next level" view based on the kind returned by
// /v1/locations/scan. The worker can drill from zone -> shelf -> bin,
// or land directly on a bin if they scanned its code.

interface ZoneResult {
  kind: "zone";
  warehouse: { code: string; name: string };
  zone: string;
  shelves: { shelf: string; code: string; totalBins: number; totalQty: number }[];
}
interface ShelfResult {
  kind: "shelf";
  warehouse: { code: string; name: string };
  zone: string;
  shelf: string;
  bins: {
    id: string;
    code: string;
    bin: string;
    qty: number;
    reservedQty: number;
    capacity: number;
    batch: string | null;
    product?: { sku: string; name: string; uom?: string } | null;
    variant?: { sku: string; size?: string | null; uom?: string | null } | null;
  }[];
}
interface BinResult {
  kind: "bin";
  bin: { id: string; code: string };
}
interface ProductResult {
  kind: "product";
  product: { id: string; sku: string; name: string; uom?: string; stockOnHand?: number };
  matchedVariantId?: string | null;
  bins: {
    id: string;
    code: string;
    warehouseCode: string;
    zone: string;
    shelf: string;
    bin: string;
    qty: number;
    reservedQty: number;
    batch: string | null;
  }[];
}

type Result = ZoneResult | ShelfResult | BinResult | ProductResult;

export const MobileLocation = () => {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setError(null);
    setData(null);
    api
      .resolveLocation(decodeURIComponent(code))
      .then((res) => {
        if (cancelled) return;
        const r = res as unknown as Result;
        if (r.kind === "bin" && r.bin?.id) {
          nav(`/m/bin/${r.bin.id}`, { replace: true });
          return;
        }
        setData(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : (err as Error).message
        );
      });
    return () => {
      cancelled = true;
    };
  }, [code, nav]);

  if (error) {
    return (
      <div className="px-4 pt-6">
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
        <button
          type="button"
          onClick={() => nav("/m/scan")}
          className="mt-4 w-full rounded-xl bg-[#003087] py-3 text-sm font-semibold text-white"
        >
          Scan again
        </button>
      </div>
    );
  }
  if (!data) {
    return <div className="px-4 pt-6 text-sm text-slate-500">Loading…</div>;
  }

  if (data.kind === "zone") {
    return (
      <div className="px-4 pt-4">
        <Header
          title={`Zone ${data.zone}`}
          sub={`${data.warehouse.code} — ${data.shelves.length} shelf(ves)`}
        />
        <div className="space-y-2 pb-4">
          {data.shelves.map((s) => (
            <Link
              key={s.shelf}
              to={`/m/loc/${encodeURIComponent(s.code)}`}
              className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-[#003087]">{s.shelf}</div>
                <div className="text-xs text-slate-500">
                  {s.totalBins} bins · {s.totalQty} units
                </div>
              </div>
              <span className="text-slate-400">›</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (data.kind === "shelf") {
    return (
      <div className="px-4 pt-4">
        <Header
          title={`Shelf ${data.shelf}`}
          sub={`${data.warehouse.code} · zone ${data.zone}`}
        />
        <div className="space-y-2 pb-4">
          {data.bins.map((b) => (
            <Link
              key={b.id}
              to={`/m/bin/${b.id}`}
              className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-[#003087]">
                  {b.bin}
                </div>
                <div className="text-xs text-slate-500">
                  {b.product
                    ? `${b.variant?.sku ?? b.product.sku}${b.variant?.size ? ` · ${b.variant.size}` : ""} · ${b.qty} ${b.variant?.uom ?? b.product.uom ?? "u"}`
                    : "empty"}
                </div>
              </div>
              <span className="text-slate-400">›</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (data.kind === "product") {
    return (
      <div className="px-4 pt-4">
        <Header title={data.product.sku} sub={data.product.name} />
        <div className="mb-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Total stock on hand</div>
          <div className="text-2xl font-bold tabular-nums">
            {data.product.stockOnHand ?? 0}{" "}
            <span className="text-base font-normal text-slate-500">
              {data.product.uom ?? ""}
            </span>
          </div>
        </div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Stocked in {data.bins.length} bin{data.bins.length === 1 ? "" : "s"}
        </h3>
        <div className="space-y-2 pb-4">
          {data.bins.map((b) => (
            <Link
              key={b.id}
              to={`/m/bin/${b.id}`}
              className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200"
            >
              <div>
                <div className="font-mono text-xs text-slate-500">{b.code}</div>
                <div className="text-sm font-semibold text-[#003087]">
                  {b.qty} {data.product.uom ?? ""}
                </div>
                {b.batch && (
                  <div className="text-[11px] text-slate-500">batch {b.batch}</div>
                )}
              </div>
              <span className="text-slate-400">›</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return null;
};

const Header = ({ title, sub }: { title: string; sub: string }) => (
  <div className="mb-3">
    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
      {sub}
    </div>
    <h1 className="text-xl font-bold text-slate-900">{title}</h1>
  </div>
);
