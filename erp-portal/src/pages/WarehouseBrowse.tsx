import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, LayoutGrid, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { EmptyState } from "@/components/common/EmptyState";
import { Toolbar } from "@/components/common/Toolbar";
import { ShelfMasonryCard } from "@/components/warehouse/ShelfMasonryCard";
import { WarehouseBrowseSidebar } from "@/components/warehouse/WarehouseBrowseSidebar";
import {
  groupBinsByShelf,
  shelfMatchesFilter,
} from "@/components/warehouse/warehouse-layout-utils";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

type RowEdit = { barcode: string; qty: string };

type BulkResult = {
  applied: number;
  skipped: number;
  errors: number;
};

const readSidebarOpen = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem("warehouse-browse-sidebar") !== "0";
  } catch {
    return true;
  }
};

/** Default warehouse UI — masonry shelf browser with collapsible filter rail. */
export const WarehouseBrowse = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const liveBins = useApi(() => api.warehousesAndBins(), []);
  const liveWarehouses = useApi(() => api.warehouses(), []);

  const bins = liveBins.data ?? [];
  const warehouses = liveWarehouses.data ?? [];
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active).sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses]
  );

  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit] = useState(false);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [busy, setBusy] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("warehouse-browse-sidebar", sidebarOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [sidebarOpen]);

  // Inventory → Locations "Map" deep-link passes binFilter in location state.
  useEffect(() => {
    const state = location.state as { binFilter?: string } | null;
    if (state?.binFilter) setSearch(state.binFilter);
  }, [location.state]);

  const effectiveWh = warehouseCode || activeWarehouses[0]?.code || "";

  const whBins = useMemo(
    () => bins.filter((b) => !effectiveWh || b.warehouse === effectiveWh),
    [bins, effectiveWh]
  );

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const b of whBins) set.add(b.zone);
    return [...set].sort((a, b) => {
      if (a === "_" || a === "WH") return 1;
      if (b === "_" || b === "WH") return -1;
      return a.localeCompare(b);
    });
  }, [whBins]);

  const allShelves = useMemo(() => groupBinsByShelf(whBins), [whBins]);

  const filteredShelves = useMemo(() => {
    const q = search.trim();
    return allShelves.filter((g) => {
      if (zoneFilter) {
        const matchesZone =
          g.zone === zoneFilter ||
          (g.zone === "" && (zoneFilter === "_" || zoneFilter === "WH"));
        if (!matchesZone) return false;
      }
      if (!q) return true;
      return shelfMatchesFilter(g, q);
    });
  }, [allShelves, zoneFilter, search]);

  // Default: all visible shelves expanded whenever the filter set changes.
  useEffect(() => {
    setExpanded(new Set(filteredShelves.map((g) => g.key)));
  }, [filteredShelves]);

  const shelvesByZone = useMemo(() => {
    const map = new Map<string, typeof filteredShelves>();
    for (const g of filteredShelves) {
      const label = g.zoneLabel;
      const list = map.get(label) ?? [];
      list.push(g);
      map.set(label, list);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Warehouse level") return 1;
      if (b === "Warehouse level") return -1;
      return a.localeCompare(b);
    });
  }, [filteredShelves]);

  const totalBins = whBins.length;
  const occupiedBins = whBins.filter((b) => (b.qty ?? 0) > 0).length;
  const totalQty = whBins.reduce((s, b) => s + (b.qty ?? 0), 0);

  const pendingEdits = useMemo(() => {
    let n = 0;
    for (const id of Object.keys(edits)) {
      const row = edits[id];
      if (!row) continue;
      if (row.barcode.trim() || row.qty.trim()) n += 1;
    }
    return n;
  }, [edits]);

  const toggleShelf = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filteredShelves.map((g) => g.key)));
  const collapseAll = () => setExpanded(new Set());

  const setRowEdit = (binId: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [binId]: {
        barcode: prev[binId]?.barcode ?? "",
        qty: prev[binId]?.qty ?? "",
        ...patch,
      },
    }));
  };

  const saveBulk = async () => {
    const wh = activeWarehouses.find((w) => w.code === effectiveWh);
    if (!wh) {
      setErrBanner("Pick a warehouse.");
      return;
    }

    const items: { binId: string; barcode?: string; qty?: number }[] = [];
    for (const [binId, row] of Object.entries(edits)) {
      const barcode = row.barcode.trim();
      const qtyRaw = row.qty.trim();
      if (!barcode && !qtyRaw) continue;

      const item: { binId: string; barcode?: string; qty?: number } = { binId };
      if (barcode) item.barcode = barcode;
      if (qtyRaw) {
        const qty = Number(qtyRaw);
        if (Number.isNaN(qty) || qty < 0) {
          setErrBanner(`Invalid qty for bin ${binId}.`);
          return;
        }
        item.qty = qty;
      }
      items.push(item);
    }

    if (items.length === 0) {
      setErrBanner("Enter a barcode and/or qty on at least one bin.");
      return;
    }

    const byZone = new Map<string, typeof items>();
    for (const item of items) {
      const bin = bins.find((b) => b.id === item.binId);
      if (!bin) continue;
      const list = byZone.get(bin.zone) ?? [];
      list.push(item);
      byZone.set(bin.zone, list);
    }

    setBusy(true);
    setErrBanner(null);
    setOkBanner(null);
    try {
      let applied = 0;
      let skipped = 0;
      let errors = 0;

      for (const [zone, zoneItems] of byZone) {
        const res = (await api.bulkZoneStock(wh.id, zone, {
          reasonCode: "physical_match",
          items: zoneItems,
        })) as BulkResult & { results?: Array<{ binId: string; status: string }> };

        applied += res.applied;
        skipped += res.skipped;
        errors += res.errors;

        if (res.results) {
          setEdits((prev) => {
            const next = { ...prev };
            for (const r of res.results!) {
              if (r.status === "applied") delete next[r.binId];
            }
            return next;
          });
        }
      }

      await liveBins.refetch();
      setOkBanner(`Updated ${applied} bin(s), skipped ${skipped}, ${errors} error(s).`);
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loading = liveBins.loading && !liveBins.data;

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <Toolbar left={<h2 className="text-h3 font-bold">Warehouse</h2>} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState loading />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-canvas min-h-0">
      <Toolbar
        left={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide filter panel" : "Show filter panel"}
            />
            <h2 className="text-body font-bold flex items-center gap-2">
              <LayoutGrid size={18} className="text-primary" />
              Warehouse
            </h2>
            {effectiveWh && (
              <Chip tone="neutral" size="sm">
                {effectiveWh}
              </Chip>
            )}
            <span className="text-caption text-ink-muted hidden sm:inline">
              {occupiedBins}/{totalBins} bins · {num(totalQty)} units · {filteredShelves.length}{" "}
              shelves
            </span>
          </>
        }
      />

      {(okBanner || errBanner) && (
        <div
          className={cn(
            "px-3 py-1.5 border-b text-body-sm flex items-center gap-2 shrink-0",
            okBanner
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          {okBanner && <CheckCircle2 size={14} />}
          <span className="flex-1 truncate">{okBanner ?? errBanner}</span>
          <button
            type="button"
            className="underline text-caption shrink-0"
            onClick={() => {
              setOkBanner(null);
              setErrBanner(null);
            }}
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        <WarehouseBrowseSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => !v)}
          effectiveWh={effectiveWh}
          activeWarehouses={activeWarehouses}
          onWarehouseChange={(code) => {
            setWarehouseCode(code);
            setZoneFilter("");
            setEdits({});
          }}
          zones={zones}
          zoneFilter={zoneFilter}
          onZoneChange={setZoneFilter}
          search={search}
          onSearchChange={setSearch}
          bulkEdit={bulkEdit}
          onBulkEditToggle={() => setBulkEdit((v) => !v)}
          pendingEdits={pendingEdits}
          busy={busy}
          onSave={() => void saveBulk()}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onTreeView={() => navigate("/warehouse/classic")}
          onTransfers={() => navigate("/transfers")}
          occupiedBins={occupiedBins}
          totalBins={totalBins}
          totalQty={totalQty}
          shelfCount={filteredShelves.length}
        />

        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-3">
          {filteredShelves.length === 0 ? (
            <EmptyState
              empty
              emptyTitle="No shelves match"
              emptyDescription="Try another zone or clear the search filter."
            />
          ) : (
            <div className="space-y-4">
              {shelvesByZone.map(([zoneName, shelves]) => (
                <section key={zoneName}>
                  <div className="flex items-center gap-2 mb-1.5 sticky top-0 z-10 bg-canvas/95 backdrop-blur py-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                      {zoneName}
                    </span>
                    <Chip size="sm" tone="neutral">
                      {shelves.length} shelves
                    </Chip>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="columns-1 sm:columns-2 lg:columns-3 2xl:columns-4 gap-2.5 [column-fill:balance]">
                    {shelves.map((g) => (
                      <ShelfMasonryCard
                        key={g.key}
                        group={g}
                        expanded={expanded.has(g.key)}
                        bulkEdit={bulkEdit}
                        edits={edits}
                        onToggle={() => toggleShelf(g.key)}
                        onEdit={(binId, patch) => setRowEdit(binId, patch)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
