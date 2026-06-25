import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import {
  CollapsibleBinList,
  CollapsibleShelfList,
  type LocationBinRow,
} from "../components/CollapsibleLocationList";

// =====================================================================
// /m/loc/:code — zone / shelf / product drill-down from scan
// =====================================================================

interface ZoneResult {
  kind: "zone";
  warehouse: { code: string; name: string };
  zone: string;
  totalQty: number;
  totalBins: number;
  stockedBins: number;
  code?: string;
  products: {
    sku: string;
    name: string;
    qty: number;
    uom?: string | null;
  }[];
  shelves: {
    shelf: string;
    code: string;
    totalBins: number;
    stockedBins?: number;
    totalQty: number;
  }[];
}

interface ShelfResult {
  kind: "shelf";
  warehouse: { code: string; name: string };
  zone: string;
  shelf: string;
  code?: string;
  totalQty: number;
  totalBins: number;
  stockedBins: number;
  bins: LocationBinRow[];
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

const loadShelfBins = async (shelfCode: string): Promise<LocationBinRow[]> => {
  const res = (await api.resolveLocation(shelfCode)) as unknown as ShelfResult;
  if (res.kind !== "shelf") return [];
  return res.bins;
};

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
          sub={`${data.warehouse.code} — tap a shelf to expand bins`}
        />
        <div className="mb-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Total in zone</div>
          <div className="text-2xl font-bold tabular-nums text-[#003087]">
            {data.totalQty}{" "}
            <span className="text-base font-normal text-slate-500">units</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.stockedBins} stocked · {data.totalBins} bin slot
            {data.totalBins === 1 ? "" : "s"}
          </div>
          {data.code && (
            <div className="mt-1 font-mono text-[10px] text-slate-400">{data.code}</div>
          )}
        </div>
        {data.products.length > 0 && (
          <>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Products in zone
            </h3>
            <div className="mb-3 space-y-2">
              {data.products.map((p) => (
                <div
                  key={p.sku}
                  className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200"
                >
                  <div className="font-mono text-sm font-semibold text-[#003087]">
                    {p.sku}
                  </div>
                  <div className="text-xs text-slate-500">{p.name}</div>
                  <div className="text-sm font-semibold tabular-nums">
                    {p.qty} {p.uom ?? "u"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <CollapsibleShelfList shelves={data.shelves} loadBins={loadShelfBins} />
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
        <div className="mb-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Total on shelf</div>
          <div className="text-2xl font-bold tabular-nums text-[#003087]">
            {data.totalQty}{" "}
            <span className="text-base font-normal text-slate-500">units</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.stockedBins} stocked · {data.totalBins} bin
            {data.totalBins === 1 ? "" : "s"}
          </div>
          {data.code && (
            <div className="mt-1 font-mono text-[10px] text-slate-400">{data.code}</div>
          )}
        </div>
        <CollapsibleBinList
          bins={data.bins}
          defaultExpanded
          emptyMessage="No bin slots on this shelf yet. Bins appear when stock is put away."
        />
      </div>
    );
  }

  if (data.kind === "product") {
    const productBins: LocationBinRow[] = data.bins.map((b) => ({
      id: b.id,
      code: b.code,
      bin: b.bin,
      qty: b.qty,
      reservedQty: b.reservedQty,
      batch: b.batch,
      product: {
        sku: data.product.sku,
        name: data.product.name,
        uom: data.product.uom,
      },
    }));
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
        <CollapsibleBinList
          bins={productBins}
          defaultExpanded
          emptyMessage="No bins with this product."
        />
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
