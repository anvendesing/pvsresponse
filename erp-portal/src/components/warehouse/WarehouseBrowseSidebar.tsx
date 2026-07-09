import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Save,
  Search,
  Warehouse as WHIcon,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { CollapsibleStats } from "@/components/common/CollapsibleStats";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { zoneLabel } from "@/components/warehouse/warehouse-layout-utils";
import type { WarehouseRow } from "@/lib/api";

const selectCls =
  "h-8 w-full rounded-md border border-border bg-white px-2 text-body-sm text-ink";

interface Props {
  open: boolean;
  onToggle: () => void;
  effectiveWh: string;
  activeWarehouses: WarehouseRow[];
  onWarehouseChange: (code: string) => void;
  zones: string[];
  zoneFilter: string;
  onZoneChange: (zone: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  bulkEdit: boolean;
  onBulkEditToggle: () => void;
  pendingEdits: number;
  busy: boolean;
  onSave: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onTreeView: () => void;
  onTransfers: () => void;
  occupiedBins: number;
  totalBins: number;
  totalQty: number;
  shelfCount: number;
}

export const WarehouseBrowseSidebar = ({
  open,
  onToggle,
  effectiveWh,
  activeWarehouses,
  onWarehouseChange,
  zones,
  zoneFilter,
  onZoneChange,
  search,
  onSearchChange,
  bulkEdit,
  onBulkEditToggle,
  pendingEdits,
  busy,
  onSave,
  onExpandAll,
  onCollapseAll,
  onTreeView,
  onTransfers,
  occupiedBins,
  totalBins,
  totalQty,
  shelfCount,
}: Props) => (
  <>
    {!open && (
      <button
        type="button"
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 h-16 w-6 rounded-r-md border border-l-0 border-border bg-surface shadow-sm flex items-center justify-center text-ink-muted hover:text-primary hover:bg-primary/5"
        title="Show filters"
      >
        <ChevronRight size={14} />
      </button>
    )}

    <aside
      className={cn(
        "shrink-0 border-r border-border bg-surface flex flex-col transition-[width] duration-200 overflow-hidden relative",
        open ? "w-[220px]" : "w-0 border-r-0"
      )}
    >
      {open && (
        <>
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border shrink-0">
            <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
              Filters
            </span>
            <button
              type="button"
              onClick={onToggle}
              className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas hover:text-ink"
              title="Hide filters"
            >
              <ChevronLeft size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
            <CollapsibleStats
              storageKey="warehouse-browse"
              title="Stats"
              defaultOpen={false}
              className="border rounded-lg overflow-hidden"
              summary={
                <>
                  {occupiedBins}/{totalBins} · {num(totalQty)} u · {shelfCount} sh
                </>
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Kpi
                  label="Occupied"
                  value={`${occupiedBins}/${totalBins}`}
                  deltaSuffix=""
                  accent="primary"
                />
                <Kpi label="Units" value={num(totalQty)} deltaSuffix="" accent="success" />
                <Kpi label="Shelves" value={String(shelfCount)} deltaSuffix="" accent="none" />
                <Kpi
                  label="Util"
                  value={totalBins ? `${Math.round((occupiedBins / totalBins) * 100)}%` : "—"}
                  deltaSuffix=""
                  accent="warning"
                />
              </div>
            </CollapsibleStats>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Warehouse
              </span>
              <select
                className={selectCls}
                value={effectiveWh}
                onChange={(e) => onWarehouseChange(e.target.value)}
              >
                {activeWarehouses.map((w) => (
                  <option key={w.id} value={w.code}>
                    {w.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Zone
              </span>
              <select
                className={selectCls}
                value={zoneFilter}
                onChange={(e) => onZoneChange(e.target.value)}
              >
                <option value="">All zones</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {zoneLabel(z)}
                  </option>
                ))}
              </select>
            </label>

            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Shelf, SKU…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />

            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="flex-1" onClick={onExpandAll}>
                Expand
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={onCollapseAll}>
                Collapse
              </Button>
            </div>

            <div className="border-t border-border pt-2 space-y-1.5">
              <Button
                size="sm"
                variant={bulkEdit ? "primary" : "outline"}
                className="w-full"
                icon={<ClipboardList size={14} />}
                onClick={onBulkEditToggle}
              >
                {bulkEdit ? "Bulk edit on" : "Bulk edit"}
              </Button>
              <Button
                size="sm"
                className="w-full"
                icon={<Save size={14} />}
                onClick={onSave}
                disabled={!bulkEdit || busy || pendingEdits === 0}
              >
                {busy ? "Saving…" : pendingEdits > 0 ? `Save (${pendingEdits})` : "Save"}
              </Button>
            </div>

            <div className="border-t border-border pt-2 space-y-1">
              <Button size="sm" variant="ghost" className="w-full justify-start" onClick={onTreeView}>
                Tree view
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start"
                icon={<ArrowRightLeft size={14} />}
                onClick={onTransfers}
              >
                Transfers
              </Button>
            </div>
          </div>

          {effectiveWh && (
            <div className="shrink-0 px-2 py-1.5 border-t border-border text-[10px] text-ink-muted flex items-center gap-1">
              <WHIcon size={10} />
              {effectiveWh}
            </div>
          )}
        </>
      )}
    </aside>
  </>
);
