import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api, type InventoryLocationBinRow, type InventoryLocationMatch } from "@/lib/api";
import { num } from "@/lib/format";

interface FlatRow {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  /**
   * Variant SKU resolved from the *bin's own* `variantId`. NULL
   * means this bin stores the parent product in bulk form. This used
   * to take `m.matchedVariant?.sku`, which painted one matched
   * variant across every bin (so a query for "CAOL" labelled all
   * bins as the alphabetically-first variant `CAOL-AMU-5L-01`, even
   * the bins holding 250ml/500ml/1L stock or bulk parent).
   */
  variantSku: string | null;
  variantSize: string | null;
  variantUom: string | null;
  bin: InventoryLocationBinRow;
}

function flatten(matches: InventoryLocationMatch[]): FlatRow[] {
  return matches.flatMap((m) =>
    m.bins.map((b) => ({
      productId: m.productId,
      sku: m.sku,
      name: m.name,
      uom: m.uom,
      variantSku: b.variantSku ?? null,
      variantSize: b.variantSize ?? null,
      variantUom: b.variantUom ?? null,
      bin: b,
    }))
  );
}

interface Props {
  seedProductId?: string;
  products: { id: string; sku: string; name: string }[];
  /**
   * Bump from the parent to force a fresh fetch (e.g. after an Adjust
   * Stock post writes new bin quantities). The panel cached the bin
   * list on mount before this prop was added, which made changes look
   * like they didn't apply until a full page reload.
   */
  refreshKey?: number;
}

export const InventoryLocationsPanel = ({ seedProductId, products, refreshKey = 0 }: Props) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const seed = products.find((p) => p.id === seedProductId);

  const [query, setQuery] = useState(seed?.sku ?? "");
  const [allRows, setAllRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all bins on mount AND whenever the parent bumps refreshKey
  // (e.g. after a stock adjustment posts new bin quantities).
  useEffect(() => {
    setLoading(true);
    api.inventoryLocations("")
      .then((matches) => { setAllRows(flatten(matches)); setError(null); })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  // If a seed product is passed (deep-link), pre-fill the search
  useEffect(() => {
    if (seed) setQuery(seed.sku);
  }, [seed?.sku]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side filter — instant as you type
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allRows;
    return allRows.filter(
      (r) =>
        r.sku.toLowerCase().includes(term) ||
        r.name.toLowerCase().includes(term) ||
        (r.variantSku?.toLowerCase().includes(term) ?? false) ||
        r.bin.location.toLowerCase().includes(term) ||
        r.bin.warehouseCode.toLowerCase().includes(term)
    );
  }, [allRows, query]);

  const totalQty = rows.reduce((s, r) => s + r.bin.qty, 0);
  const totalFree = rows.reduce((s, r) => s + r.bin.free, 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* ── Search bar ── */}
      <div className="shrink-0 px-4 py-2.5 bg-canvas border-b border-border flex items-center gap-3">
        <MapPin size={15} className="text-primary shrink-0" />
        <span className="font-bold text-body-sm text-ink shrink-0 hidden sm:block">Stock locations</span>
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by SKU, name or bin code…"
            className="w-full h-8 pl-8 pr-7 rounded border border-border bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-ink-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="text-caption text-ink-muted shrink-0">
          {loading ? "Loading…" : `${rows.length} of ${allRows.length} bin${allRows.length === 1 ? "" : "s"}`}
        </span>
        {error && <span className="text-caption text-danger shrink-0">{error}</span>}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-body-sm text-ink-muted animate-pulse">
            Loading bin locations…
          </div>
        ) : allRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-muted">
            <MapPin size={28} className="text-ink-muted/30" />
            <p className="text-body-sm">No bins have stock yet. Receive a GRN or adjust stock to populate locations.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-body-sm text-ink-muted">
            No bins match <span className="font-mono mx-1 text-ink">{query}</span>
          </div>
        ) : (
          <table className="w-full text-body-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-canvas border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-caption font-semibold uppercase text-ink-muted">Product / SKU</th>
                <th className="px-4 py-2.5 text-left text-caption font-semibold uppercase text-ink-muted">Warehouse</th>
                <th className="px-4 py-2.5 text-left text-caption font-semibold uppercase text-ink-muted">Bin location</th>
                <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase text-ink-muted">Qty</th>
                <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase text-ink-muted">Reserved</th>
                <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase text-ink-muted">Free</th>
                <th className="px-4 py-2.5 w-[60px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.productId}-${r.bin.binId}-${i}`}
                  className="border-t border-border hover:bg-canvas/70 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold text-primary text-caption">
                      {r.variantSku ?? r.sku}
                    </div>
                    <div className="text-body-sm text-ink truncate max-w-[160px]" title={r.name}>{r.name}</div>
                    {r.variantSku ? (
                      <Chip size="sm" tone="info" className="mt-0.5">
                        {r.variantSize ? `${r.variantSize} · ` : ""}
                        {r.variantUom ?? "variant"}
                      </Chip>
                    ) : (
                      <Chip size="sm" tone="neutral" className="mt-0.5">
                        bulk · {r.uom}
                      </Chip>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-ink">{r.bin.warehouseCode}</div>
                    <div className="text-caption text-ink-muted">{r.bin.warehouseName}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-bold text-primary">{r.bin.location}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum font-semibold">{num(r.bin.qty)}</td>
                  <td className="px-4 py-2.5 text-right tnum text-ink-muted">{num(r.bin.reserved)}</td>
                  <td className="px-4 py-2.5 text-right tnum font-semibold text-success">{num(r.bin.free)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ExternalLink size={12} />}
                      onClick={() => navigate("/warehouse", { state: { binFilter: r.bin.location } })}
                      title="Open in Warehouse map"
                    >
                      Map
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-canvas">
                  <td colSpan={3} className="px-4 py-2 text-caption font-semibold uppercase text-ink-muted">
                    Total · {rows.length} bin{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2 text-right tnum font-semibold">{num(totalQty)}</td>
                  <td className="px-4 py-2 text-right tnum text-ink-muted">
                    {num(rows.reduce((s, r) => s + r.bin.reserved, 0))}
                  </td>
                  <td className="px-4 py-2 text-right tnum font-semibold text-success">{num(totalFree)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
};
