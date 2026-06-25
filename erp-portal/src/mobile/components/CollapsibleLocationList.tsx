import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

export type LocationBinRow = {
  id: string;
  code?: string;
  bin: string;
  qty: number;
  reservedQty?: number;
  capacity?: number;
  batch?: string | null;
  product?: { sku: string; name: string; uom?: string } | null;
  variant?: { sku: string; size?: string | null; uom?: string | null } | null;
};

interface Props {
  bins: LocationBinRow[];
  /** When true, bin detail rows start expanded. */
  defaultExpanded?: boolean;
  emptyMessage?: string;
}

export const CollapsibleBinList = ({
  bins,
  defaultExpanded = true,
  emptyMessage = "No bins on this shelf.",
}: Props) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (!defaultExpanded) return {};
    return Object.fromEntries(bins.map((b) => [b.id, true]));
  });
  const [allOpen, setAllOpen] = useState(defaultExpanded);

  const toggle = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !p[id] }));
  };

  const expandAll = () => {
    setAllOpen(true);
    setExpanded(Object.fromEntries(bins.map((b) => [b.id, true])));
  };

  const collapseAll = () => {
    setAllOpen(false);
    setExpanded({});
  };

  if (bins.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {bins.length} bin{bins.length === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={expandAll}
            className={`text-xs font-semibold ${allOpen ? "text-[#003087]" : "text-slate-500"}`}
          >
            Expand all
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={collapseAll}
            className={`text-xs font-semibold ${!allOpen ? "text-[#003087]" : "text-slate-500"}`}
          >
            Collapse all
          </button>
        </div>
      </div>
      <div className="space-y-2 pb-4">
        {bins.map((b) => {
          const open = !!expanded[b.id];
          const sku = b.variant?.sku ?? b.product?.sku;
          const uom = b.variant?.uom ?? b.product?.uom ?? "u";
          return (
            <div
              key={b.id}
              className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggle(b.id)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                {open ? (
                  <ChevronDown size={16} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold text-[#003087]">
                    {b.bin}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {b.product
                      ? `${sku ?? "—"} · ${b.qty} ${uom}`
                      : "empty slot"}
                  </div>
                </div>
                <Link
                  to={`/m/bin/${b.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-xs font-semibold text-[#003087]"
                >
                  Open
                </Link>
              </button>
              {open && (
                <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 space-y-1 bg-slate-50/80">
                  {b.code && (
                    <div>
                      <span className="text-slate-400">Scan code </span>
                      <span className="font-mono">{b.code}</span>
                    </div>
                  )}
                  {b.product ? (
                    <>
                      <div className="font-medium text-slate-800">{b.product.name}</div>
                      {b.variant?.size && (
                        <div className="text-slate-500">{b.variant.size}</div>
                      )}
                      <div className="tabular-nums">
                        Qty {b.qty} {uom}
                        {(b.reservedQty ?? 0) > 0 && (
                          <span className="text-amber-700"> · reserved {b.reservedQty}</span>
                        )}
                      </div>
                      {b.batch && <div>Batch {b.batch}</div>}
                      {b.capacity != null && b.capacity > 0 && (
                        <div className="text-slate-400">Capacity {b.capacity}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-slate-500">No product assigned</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export type ShelfSummary = {
  shelf: string;
  code: string;
  totalBins: number;
  stockedBins?: number;
  totalQty: number;
};

interface ShelfListProps {
  shelves: ShelfSummary[];
  loadBins: (shelfCode: string) => Promise<LocationBinRow[]>;
}

export const CollapsibleShelfList = ({ shelves, loadBins }: ShelfListProps) => {
  const [openShelves, setOpenShelves] = useState<Set<string>>(new Set());
  const [binsByShelf, setBinsByShelf] = useState<Record<string, LocationBinRow[]>>({});
  const [loadingShelf, setLoadingShelf] = useState<string | null>(null);

  const toggleShelf = async (s: ShelfSummary) => {
    if (openShelves.has(s.shelf)) {
      setOpenShelves((prev) => {
        const next = new Set(prev);
        next.delete(s.shelf);
        return next;
      });
      return;
    }
    if (!binsByShelf[s.shelf]) {
      setLoadingShelf(s.shelf);
      try {
        const rows = await loadBins(s.code);
        setBinsByShelf((p) => ({ ...p, [s.shelf]: rows }));
      } finally {
        setLoadingShelf(null);
      }
    }
    setOpenShelves((prev) => new Set(prev).add(s.shelf));
  };

  const expandAll = async () => {
    for (const s of shelves) {
      if (!binsByShelf[s.shelf]) {
        setLoadingShelf(s.shelf);
        try {
          const rows = await loadBins(s.code);
          setBinsByShelf((p) => ({ ...p, [s.shelf]: rows }));
        } finally {
          setLoadingShelf(null);
        }
      }
    }
    setOpenShelves(new Set(shelves.map((s) => s.shelf)));
  };

  const collapseAll = () => setOpenShelves(new Set());

  if (shelves.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        No shelves in this zone yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Shelves
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void expandAll()}
            className="text-xs font-semibold text-slate-500"
          >
            Expand all
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-xs font-semibold text-slate-500"
          >
            Collapse all
          </button>
        </div>
      </div>
      <div className="space-y-2 pb-4">
        {shelves.map((s) => {
          const open = openShelves.has(s.shelf);
          const bins = binsByShelf[s.shelf] ?? [];
          return (
            <div
              key={s.shelf}
              className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => void toggleShelf(s)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                {open ? (
                  <ChevronDown size={16} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold text-[#003087]">
                    Shelf {s.shelf}
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.totalBins} bins · {s.totalQty} units
                    {s.stockedBins != null && s.stockedBins > 0
                      ? ` · ${s.stockedBins} stocked`
                      : ""}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-slate-400 shrink-0 max-w-[5rem] truncate">
                  {s.code}
                </span>
              </button>
              {open && (
                <div className="border-t border-slate-100 px-3 py-2 bg-slate-50/50">
                  {loadingShelf === s.shelf && bins.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-400 animate-pulse">
                      Loading bins…
                    </div>
                  ) : (
                    <CollapsibleBinList
                      bins={bins}
                      defaultExpanded
                      emptyMessage="No bin slots on this shelf yet."
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
