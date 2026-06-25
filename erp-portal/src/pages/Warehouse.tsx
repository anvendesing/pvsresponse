import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Map as MapIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Warehouse as WHIcon,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { CollapsibleStats } from "@/components/common/CollapsibleStats";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Bin } from "@/data/types";
import { num } from "@/lib/format";
import { csvStamp, downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/cn";
import { BinLayoutModal } from "@/components/warehouse/BinLayoutModal";
import { BulkZoneStockPanel } from "@/components/warehouse/BulkZoneStockPanel";

import type { WarehouseRow } from "@/lib/api";

interface TreeNode {
  id: string;
  label: string;
  count: number;
  children?: TreeNode[];
  bin?: Bin;
}

type ZoneCtx = { warehouseCode: string; zone: string };
type ShelfCtx = { warehouseCode: string; zone: string; shelf: string };

// Placeholder values that mean "stock is held at the parent level":
//   - zone "_" / "WH"  → stock at warehouse level (no zone assigned)
//   - shelf "00"       → stock at zone level (no shelf assigned)
//   - bin "00"         → stock at shelf level (no bin assigned)
// We keep these in the DB for compactness, but the tree should
// present stock at its real level instead of leaking the placeholder
// labels as fake child nodes (e.g. "Zone WH", shelf "00", bin "00").
const PLACEHOLDER_ZONES = new Set(["_", "WH"]);
const PLACEHOLDER_SHELF = "00";
const PLACEHOLDER_BIN = "00";

const isPlaceholderZone = (z: string) => PLACEHOLDER_ZONES.has(z);
const isPlaceholderShelf = (s: string) => s === PLACEHOLDER_SHELF;
const isPlaceholderBin = (b: string) => b === PLACEHOLDER_BIN;

// Display label for a leaf row. When the bin code is the placeholder
// "00" we show the SHELF label (the real address of the stock).
const leafLabel = (b: Bin): string => {
  if (!isPlaceholderBin(b.bin)) return b.bin;
  if (!isPlaceholderShelf(b.shelf)) return b.shelf;
  if (!isPlaceholderZone(b.zone)) return b.zone;
  return b.warehouse ?? "warehouse";
};

const buildTree = (allBins: Bin[]): TreeNode[] => {
  // warehouseCode -> zoneLabel -> shelfLabel -> Bin[]
  // We collapse placeholder zones into a single virtual "Warehouse
  // level" bucket so all the WH-bulk rows land in one folder instead
  // of polluting the tree with "Zone WH" and "Zone _" siblings.
  const wMap = new Map<string, Map<string, Map<string, Bin[]>>>();
  const whNames = new Map<string, string>();

  for (const b of allBins) {
    if (b.warehouseName) whNames.set(b.warehouse, b.warehouse + "");
    const w = wMap.get(b.warehouse) ?? new Map();

    // Resolve the zone bucket for this row:
    //   - placeholder zone → "" (warehouse-level bucket)
    //   - real zone        → the zone label
    const zoneKey = isPlaceholderZone(b.zone) ? "" : b.zone;

    // Resolve the shelf bucket:
    //   - placeholder shelf → "" (zone-level / warehouse-level bucket)
    //   - real shelf        → the shelf label
    const shelfKey = isPlaceholderShelf(b.shelf) ? "" : b.shelf;

    const z = w.get(zoneKey) ?? new Map();
    const list = z.get(shelfKey) ?? [];
    list.push(b);
    z.set(shelfKey, list);
    w.set(zoneKey, z);
    wMap.set(b.warehouse, w);
  }

  const tree: TreeNode[] = [];
  for (const [wh, zones] of wMap) {
    const friendly = whNames.get(wh);
    const label = friendly ? `${friendly} · ${wh}` : wh;
    const wNode: TreeNode = { id: wh, label, count: 0, children: [] };

    // Sort: real zones alphabetical, placeholder bucket last.
    const zoneEntries = Array.from(zones.entries()).sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });

    for (const [zoneKey, shelves] of zoneEntries) {
      const zoneLabel = zoneKey === "" ? "Warehouse level" : `Zone ${zoneKey}`;
      const zNode: TreeNode = {
        id: `${wh}-${zoneKey || "_WH"}`,
        label: zoneLabel,
        count: 0,
        children: [],
      };

      const shelfEntries = Array.from(shelves.entries()).sort(([a], [b]) => {
        if (a === "") return 1;
        if (b === "") return -1;
        return a.localeCompare(b);
      });

      for (const [shelfKey, ls] of shelfEntries) {
        if (shelfKey === "") {
          // No real shelf - these bins live at the zone level (or
          // warehouse level if the zone is also placeholder). Render
          // them as leaves directly under the zone node.
          for (const b of ls) {
            zNode.children!.push({
              id: b.id,
              label: leafLabel(b),
              count: b.qty ?? 0,
              bin: b,
            });
            zNode.count += 1;
          }
          continue;
        }

        // Real shelf. Two cases:
        //  - shelf has bins (one or more rows with bin != "00")
        //  - shelf has a single placeholder bin "00" (shelf-level stock)
        const realBins = ls.filter((b) => !isPlaceholderBin(b.bin));
        const placeholderBins = ls.filter((b) => isPlaceholderBin(b.bin));

        if (realBins.length === 0 && placeholderBins.length > 0) {
          // Shelf-level stock only - render the shelf as a leaf (no
          // sub-bin node) so the user sees the shelf row clickable
          // with its qty directly.
          for (const b of placeholderBins) {
            zNode.children!.push({
              id: b.id,
              label: shelfKey,
              count: b.qty ?? 0,
              bin: b,
            });
            zNode.count += 1;
          }
          continue;
        }

        // Shelf with one or more real bins. Show as a shelf folder
        // with the bins inside. Any leftover placeholder-bin rows
        // (with qty > 0) appear inside the shelf as "shelf-level"
        // entries so nothing gets dropped silently.
        const sNode: TreeNode = {
          id: `${wh}-${zoneKey || "_WH"}-${shelfKey}`,
          label: shelfKey,
          count: realBins.length + placeholderBins.length,
          children: [
            ...realBins.map((b) => ({
              id: b.id,
              label: b.bin,
              count: b.qty ?? 0,
              bin: b,
            })),
            ...placeholderBins.map((b) => ({
              id: b.id,
              label: "shelf-level",
              count: b.qty ?? 0,
              bin: b,
            })),
          ],
        };
        zNode.children!.push(sNode);
        zNode.count += sNode.count;
      }

      wNode.children!.push(zNode);
      wNode.count += zNode.count;
    }
    tree.push(wNode);
  }
  return tree;
};

interface NodeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onPick: (b: Bin) => void;
  selectedBin?: Bin;
  filter: string;
  onZoneAction?: (warehouseCode: string, zone: string, action: "rename" | "delete") => void;
  onShelfAction?: (warehouseCode: string, zone: string, shelf: string, action: "rename" | "delete") => void;
}

const NodeRow = ({
  node, depth, expanded, toggle, onPick, selectedBin, filter,
  onZoneAction, onShelfAction,
}: NodeRowProps) => {
  const isLeaf = !!node.bin;
  const isOpen = expanded.has(node.id);
  const [hover, setHover] = useState(false);
  const visible =
    !filter ||
    node.label.toLowerCase().includes(filter.toLowerCase()) ||
    node.bin?.productName?.toLowerCase().includes(filter.toLowerCase()) ||
    (node.children?.some((c) => deepMatches(c, filter.toLowerCase())) ?? false);
  if (!visible) return null;

  if (isLeaf && node.bin) {
    const b = node.bin;
    const occupiedPct = (b.occupied / b.capacity) * 100;
    const tone =
      occupiedPct === 0 ? "neutral" : occupiedPct < 60 ? "success" : occupiedPct < 90 ? "warning" : "danger";
    return (
      <button
        onClick={() => onPick(b)}
        className={cn(
          "w-full flex items-center gap-2 pr-2 h-8 text-left text-body-sm transition-colors",
          selectedBin?.id === b.id ? "bg-primary text-white" : "hover:bg-canvas text-ink"
        )}
        style={{ paddingLeft: `${depth * 14 + 14}px` }}
      >
        <StatusDot tone={tone} className={selectedBin?.id === b.id ? "!bg-white" : ""} />
        <span className="font-mono text-caption flex-1 truncate">{b.bin}</span>
        <span className={cn("text-caption tnum", selectedBin?.id === b.id ? "" : "text-ink-muted")}>
          {b.qty ?? 0}
        </span>
      </button>
    );
  }

  // Parse the node id to understand what level this is.
  // id format: "WH-MAIN" | "WH-MAIN-A" | "WH-MAIN-A-S1"
  const parts = node.id.split("-");
  // Zones have depth=1 (one child level under warehouse), shelves depth=2.
  // Virtual "Warehouse level" bucket is also depth=1 but isn't a real
  // zone - we hide rename/delete on it since there's nothing to rename.
  const isRealZoneNode = depth === 1 && node.label.startsWith("Zone ");
  const isZoneNode = isRealZoneNode;
  const isShelfNode = depth === 2;

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        className="flex items-center h-8 hover:bg-canvas transition-colors"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <button
          onClick={() => toggle(node.id)}
          className="flex items-center gap-1 text-body-sm font-medium text-ink flex-1 min-w-0 h-full"
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="flex-1 text-left truncate">{node.label}</span>
          <span className="text-caption text-ink-muted tnum pr-1">{node.count}</span>
        </button>
        {hover && (isZoneNode || isShelfNode) && (
          <div className="flex items-center gap-0.5 pr-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Extract wh + zone from id: "WH-MAIN-A" → zone="A", wh="WH-MAIN"
                if (isZoneNode && onZoneAction) {
                  const zone = node.label.replace("Zone ", "");
                  // warehouse node id is the first segment of this node's id minus the zone suffix
                  const whCode = node.id.slice(0, node.id.lastIndexOf("-" + zone));
                  onZoneAction(whCode, zone, "rename");
                } else if (isShelfNode && onShelfAction) {
                  // shelf node id: "WH-MAIN-A-S1" → zone="A", shelf="S1"
                  const shelf = node.label;
                  // parent is zone node at depth-1: id = "WH-MAIN-A"
                  const zoneNodeId = node.id.slice(0, node.id.lastIndexOf("-" + shelf));
                  const zone = zoneNodeId.slice(zoneNodeId.lastIndexOf("-") + 1);
                  const whCode = zoneNodeId.slice(0, zoneNodeId.lastIndexOf("-" + zone));
                  onShelfAction(whCode, zone, shelf, "rename");
                }
              }}
              title="Rename"
              className="h-5 w-5 grid place-items-center rounded text-ink-muted hover:text-primary hover:bg-primary/10"
            >
              <Pencil size={10} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isZoneNode && onZoneAction) {
                  const zone = node.label.replace("Zone ", "");
                  const whCode = node.id.slice(0, node.id.lastIndexOf("-" + zone));
                  onZoneAction(whCode, zone, "delete");
                } else if (isShelfNode && onShelfAction) {
                  const shelf = node.label;
                  const zoneNodeId = node.id.slice(0, node.id.lastIndexOf("-" + shelf));
                  const zone = zoneNodeId.slice(zoneNodeId.lastIndexOf("-") + 1);
                  const whCode = zoneNodeId.slice(0, zoneNodeId.lastIndexOf("-" + zone));
                  onShelfAction(whCode, zone, shelf, "delete");
                }
              }}
              title="Delete"
              className="h-5 w-5 grid place-items-center rounded text-ink-muted hover:text-danger hover:bg-danger/10"
            >
              <Trash2 size={10} />
            </button>
          </div>
        )}
      </div>
      {isOpen &&
        node.children?.map((c) => (
          <NodeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onPick={onPick}
            selectedBin={selectedBin}
            filter={filter}
            onZoneAction={onZoneAction}
            onShelfAction={onShelfAction}
          />
        ))}
    </div>
  );
};

const deepMatches = (n: TreeNode, q: string): boolean => {
  if (n.label.toLowerCase().includes(q)) return true;
  if (n.bin?.productName?.toLowerCase().includes(q)) return true;
  return n.children?.some((c) => deepMatches(c, q)) ?? false;
};

export const Warehouse = () => {
  const nav = useNavigate();
  const location = useLocation();
  const liveBins = useApi(() => api.warehousesAndBins(), []);
  const liveWarehouses = useApi(() => api.warehouses(), []);
  const bins = liveBins.data ?? [];
  const warehouses = liveWarehouses.data ?? [];
  const tree = useMemo(() => buildTree(bins), [bins]);
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["WH-MAIN", "WH-MAIN-A", "WH-MAIN-A-R1"])
  );
  const [selected, setSelected] = useState<Bin | undefined>(undefined);
  const [filter, setFilter] = useState("");

  // From Inventory → Locations "Map" button
  useEffect(() => {
    const state = location.state as { binFilter?: string } | null;
    if (state?.binFilter) {
      setFilter(state.binFilter);
      const match = bins.find(
        (b) => `${b.zone}/${b.shelf}/${b.bin}` === state.binFilter
      );
      if (match) setSelected(match);
    }
  }, [location.state, bins]);

  // Bin layout (add/edit/delete) modal & banners.
  const [layoutMode, setLayoutMode] = useState<"single" | "bulk" | null>(null);
  const [bulkStockMode, setBulkStockMode] = useState(false);
  const [editing, setEditing] = useState<Bin | null>(null);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Zone / shelf rename + delete state.
  const [zoneAction, setZoneAction] = useState<{ ctx: ZoneCtx; action: "rename" | "delete" } | null>(null);
  const [shelfAction, setShelfAction] = useState<{ ctx: ShelfCtx; action: "rename" | "delete" } | null>(null);

  const refreshBins = async () => {
    await liveBins.refetch();
    await liveWarehouses.refetch();
  };

  const onDeleteBin = async (b: Bin) => {
    if (!confirm(`Delete bin ${b.zone}/${b.shelf}/${b.bin}? This cannot be undone.`)) return;
    setBusy(true);
    setErrBanner(null);
    try {
      await api.deleteBin(b.id);
      setOkBanner(`Bin ${b.bin} deleted.`);
      setSelected(undefined);
      await refreshBins();
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-pick the first non-empty bin once data loads
  useEffect(() => {
    if (!selected && bins.length > 0) {
      const firstWithQty = bins.find((b) => b.qty);
      if (firstWithQty) setSelected(firstWithQty);
    }
  }, [bins, selected]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const binContents = bins.filter(
    (b) =>
      selected &&
      b.warehouse === selected.warehouse &&
      b.zone === selected.zone &&
      b.shelf === selected.shelf &&
      b.qty
  );

  const columns: Column<Bin>[] = [
    {
      key: "bin",
      header: "Bin",
      cell: (r) => <span className="font-mono text-caption">{r.bin}</span>,
      width: "70px",
    },
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.productName ?? "—"}</div>
          <div className="text-caption text-ink-muted font-mono">
            {r.productSku ?? ""}
            {r.variantSku && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-info-soft text-info text-[10px] font-semibold">
                {r.variantSku}
                {r.variantUom && ` · ${r.variantUom}`}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "batch",
      header: "Batch",
      cell: (r) => <span className="font-mono text-caption">{r.batch ?? "—"}</span>,
      width: "120px",
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      cell: (r) => <span className="font-bold tnum">{num(r.qty ?? 0)}</span>,
      width: "100px",
    },
    {
      key: "occ",
      header: "Occupancy",
      cell: (r) => {
        const pct = (r.occupied / r.capacity) * 100;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 bg-canvas rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full",
                  pct < 60 ? "bg-success" : pct < 90 ? "bg-warning" : "bg-danger"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-caption text-ink-muted tnum w-9 text-right">{Math.round(pct)}%</span>
          </div>
        );
      },
      width: "200px",
    },
  ];

  const totalBins = bins.length;
  const occupiedBins = bins.filter((b) => b.qty).length;

  const exportBins = () => {
    const q = filter.trim().toLowerCase();
    const rows = (q
      ? bins.filter(
          (b) =>
            b.warehouse.toLowerCase().includes(q) ||
            b.zone.toLowerCase().includes(q) ||
            b.shelf.toLowerCase().includes(q) ||
            b.bin.toLowerCase().includes(q) ||
            (b.productSku?.toLowerCase().includes(q) ?? false) ||
            (b.productName?.toLowerCase().includes(q) ?? false) ||
            (b.variantSku?.toLowerCase().includes(q) ?? false)
        )
      : bins
    ).map((b) => [
      b.warehouse,
      b.zone,
      b.shelf,
      b.bin,
      b.productSku ?? "",
      b.productName ?? "",
      b.variantSku ?? "",
      b.variantSize ?? "",
      b.qty ?? 0,
      b.batch ?? "",
      b.capacity,
      b.occupied,
    ]);
    downloadCsv(
      `warehouse-bins-${csvStamp()}.csv`,
      [
        "Warehouse",
        "Zone",
        "Shelf",
        "Bin",
        "Product SKU",
        "Product",
        "Variant SKU",
        "Variant Size",
        "Qty",
        "Batch",
        "Capacity",
        "Occupied",
      ],
      rows
    );
  };

  if (bulkStockMode) {
    return (
      <BulkZoneStockPanel
        warehouses={warehouses}
        bins={bins}
        onClose={() => setBulkStockMode(false)}
        onSaved={async () => {
          await refreshBins();
          setOkBanner("Bulk stock update saved.");
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Warehouse</h2>
            <Chip tone="primary" icon={<WHIcon size={12} />}>WH-MAIN</Chip>
          </>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Download size={14} />}
              onClick={exportBins}
              title="Export bin stock as CSV"
            >
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<ClipboardList size={14} />}
              onClick={() => setBulkStockMode(true)}
            >
              Bulk stock update
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setLayoutMode("bulk")}
            >
              Add shelves
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setLayoutMode("single")}
            >
              Add bin
            </Button>
            <Button variant="outline" size="sm" icon={<MapIcon size={14} />}>
              3D Map
            </Button>
            <Button
              size="sm"
              icon={<ArrowRightLeft size={14} />}
              onClick={() => nav("/transfers")}
            >
              Transfers
            </Button>
          </>
        }
      />

      {(okBanner || errBanner) && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm flex items-center gap-2",
            okBanner
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          {okBanner && <CheckCircle2 size={14} />}
          <span className="flex-1">{okBanner ?? errBanner}</span>
          <button
            className="underline text-caption"
            onClick={() => {
              setOkBanner(null);
              setErrBanner(null);
            }}
          >
            dismiss
          </button>
        </div>
      )}

      <CollapsibleStats
        storageKey="warehouse"
        summary={
          <>
            Bins {occupiedBins}/{totalBins} ({Math.round((occupiedBins / totalBins) * 100)}%) ·
            18 putaway · 46 pick
          </>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Bin Utilization" value={`${Math.round((occupiedBins / totalBins) * 100)}%`} delta={1.4} accent="primary" />
          <Kpi label="Bins Active" value={`${occupiedBins}/${totalBins}`} deltaSuffix="" accent="success" />
          <Kpi label="Pending Putaway" value="18" delta={-3} deltaSuffix="" accent="warning" />
          <Kpi label="Pending Pick" value="46" delta={5} deltaSuffix="" accent="primary" />
        </div>
      </CollapsibleStats>

      <div className="flex-1 flex min-h-0">
        {/* Bin tree */}
        <aside className="w-72 bg-surface border-r border-border flex flex-col">
          <div className="p-3 border-b border-border">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Filter bins, products…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {tree.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                onPick={setSelected}
                selectedBin={selected}
                filter={filter}
                onZoneAction={(whCode, zone, action) => {
                  setZoneAction({ ctx: { warehouseCode: whCode, zone }, action });
                }}
                onShelfAction={(whCode, zone, shelf, action) => {
                  setShelfAction({ ctx: { warehouseCode: whCode, zone, shelf }, action });
                }}
              />
            ))}
          </div>
        </aside>

        {/* Bin contents */}
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            <div className="px-4 py-3 bg-surface border-b border-border flex items-center justify-between">
              <div>
                <div className="text-caption text-ink-muted uppercase">Selected location</div>
                <div className="font-mono text-h3 font-bold text-primary">
                  {selected
                    ? `${selected.warehouse} / Zone ${selected.zone} / ${selected.shelf} / ${selected.bin}`
                    : "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selected && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Pencil size={12} />}
                      onClick={() => setEditing(selected)}
                      disabled={busy}
                    >
                      Edit bin
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Trash2 size={12} />}
                      onClick={() => onDeleteBin(selected)}
                      disabled={busy || (selected.qty ?? 0) > 0}
                      title={
                        (selected.qty ?? 0) > 0
                          ? "Bin holds stock; transfer it out first."
                          : "Delete bin"
                      }
                    >
                      Delete
                    </Button>
                  </>
                )}
                <Chip tone="neutral">{binContents.length} bins occupied</Chip>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-surface">
              <DataTable
                rows={binContents}
                columns={columns}
                rowKey={(r) => r.id}
                empty="Select a shelf to view bin contents."
              />
            </div>
          </div>

        </div>
      </div>

      {layoutMode && (
        <BinLayoutModal
          allBins={bins}
          warehouses={warehouses}
          initialMode={layoutMode}
          prefill={
            selected
              ? {
                  warehouseId: warehouses.find((w) => w.code === selected.warehouse)?.id,
                  zone: selected.zone,
                  shelf: layoutMode === "single" ? selected.shelf : undefined,
                }
              : undefined
          }
          onClose={() => setLayoutMode(null)}
          onCreated={async (msg) => {
            setLayoutMode(null);
            setOkBanner(msg);
            await refreshBins();
          }}
        />
      )}

      {editing && (
        <EditBinModal
          bin={editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setOkBanner(msg);
            await refreshBins();
          }}
        />
      )}

      {zoneAction && (
        zoneAction.action === "rename" ? (
          <RenameZoneModal
            ctx={zoneAction.ctx}
            warehouses={warehouses}
            onClose={() => setZoneAction(null)}
            onDone={async (msg) => {
              setZoneAction(null);
              setOkBanner(msg);
              await refreshBins();
            }}
          />
        ) : (
          <DeleteZoneModal
            ctx={zoneAction.ctx}
            warehouses={warehouses}
            bins={bins}
            onClose={() => setZoneAction(null)}
            onDone={async (msg) => {
              setZoneAction(null);
              setSelected(undefined);
              setOkBanner(msg);
              await refreshBins();
            }}
          />
        )
      )}

      {shelfAction && (
        shelfAction.action === "rename" ? (
          <RenameShelfModal
            ctx={shelfAction.ctx}
            warehouses={warehouses}
            onClose={() => setShelfAction(null)}
            onDone={async (msg) => {
              setShelfAction(null);
              setOkBanner(msg);
              await refreshBins();
            }}
          />
        ) : (
          <DeleteShelfModal
            ctx={shelfAction.ctx}
            warehouses={warehouses}
            bins={bins}
            onClose={() => setShelfAction(null)}
            onDone={async (msg) => {
              setShelfAction(null);
              setSelected(undefined);
              setOkBanner(msg);
              await refreshBins();
            }}
          />
        )
      )}
    </div>
  );
};

// Lightweight inline editor for a single bin: rename + capacity.
// Warehouse / zone / shelf are immutable to keep stock-ledger
// addressing stable; users delete + recreate to restructure.
const EditBinModal = ({
  bin,
  onClose,
  onSaved,
}: {
  bin: Bin;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) => {
  const [label, setLabel] = useState(bin.bin);
  const [capacity, setCapacity] = useState(bin.capacity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(label)) {
      setError("Bin label must be 1-20 chars (letters / numbers / hyphen).");
      return;
    }
    if (capacity < 1) {
      setError("Capacity must be at least 1.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateBin(bin.id, { bin: label, capacity });
      onSaved(`Bin updated.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-sm rounded-lg elevation-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border">
          <div className="text-caption text-ink-muted uppercase font-semibold">
            Edit bin
          </div>
          <div className="font-mono text-body-sm">
            {bin.warehouse} / {bin.zone} / {bin.shelf} / {bin.bin}
          </div>
        </div>
        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">
            {error}
          </div>
        )}
        <div className="p-4 space-y-3">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Bin label
            </div>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value.toUpperCase())}
              placeholder="01"
            />
          </div>
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Capacity
            </div>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 1)}
            />
            <div className="text-caption text-ink-muted mt-1">
              Currently holding {bin.qty ?? 0} unit(s).
            </div>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------
// Zone / shelf bulk-action modals
// ---------------------------------------------------------------

function resolveWhId(warehouses: WarehouseRow[], code: string): string | undefined {
  return warehouses.find((w) => w.code === code)?.id;
}

const ModalShell = ({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center" onClick={onClose}>
    <div
      className="bg-surface w-full max-w-sm rounded-lg elevation-3 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-3 border-b border-border">
        <div className="text-caption text-ink-muted uppercase font-semibold">{title}</div>
        <div className="font-mono text-body-sm">{subtitle}</div>
      </div>
      {children}
    </div>
  </div>
);

const RenameZoneModal = ({
  ctx,
  warehouses,
  onClose,
  onDone,
}: {
  ctx: ZoneCtx;
  warehouses: WarehouseRow[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) => {
  const [value, setValue] = useState(ctx.zone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whId = resolveWhId(warehouses, ctx.warehouseCode);

  const submit = async () => {
    if (!whId) { setError("Warehouse not found."); return; }
    if (!/^[A-Za-z0-9-]{1,20}$/.test(value)) {
      setError("Zone label must be 1-20 chars (letters / numbers / hyphen).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.renameZone(whId, ctx.zone, value);
      onDone(`Zone ${ctx.zone} renamed to ${r.newZone} (${r.updated} bins updated).`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Rename zone" subtitle={`${ctx.warehouseCode} / Zone ${ctx.zone}`} onClose={onClose}>
      {error && <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">{error}</div>}
      <div className="p-4 space-y-3">
        <div className="text-caption text-ink-muted uppercase font-semibold mb-1">New zone label</div>
        <Input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder="A" autoFocus />
        <div className="text-caption text-ink-muted">All bins in this zone will be updated to the new label.</div>
      </div>
      <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Rename"}</Button>
      </div>
    </ModalShell>
  );
};

const DeleteZoneModal = ({
  ctx,
  warehouses,
  bins,
  onClose,
  onDone,
}: {
  ctx: ZoneCtx;
  warehouses: WarehouseRow[];
  bins: Bin[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whId = resolveWhId(warehouses, ctx.warehouseCode);
  const zoneBins = bins.filter((b) => b.warehouse === ctx.warehouseCode && b.zone === ctx.zone);
  const occupiedCount = zoneBins.filter((b) => (b.qty ?? 0) > 0).length;

  const submit = async () => {
    if (!whId) { setError("Warehouse not found."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteZone(whId, ctx.zone);
      onDone(`Zone ${ctx.zone} deleted (${r.deleted} bins removed).`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Delete zone" subtitle={`${ctx.warehouseCode} / Zone ${ctx.zone}`} onClose={onClose}>
      {error && <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">{error}</div>}
      <div className="p-4 space-y-2">
        <p className="text-body-sm">
          This will permanently delete all <strong>{zoneBins.length}</strong> bins in zone <strong>{ctx.zone}</strong>.
        </p>
        {occupiedCount > 0 ? (
          <div className="rounded border border-danger bg-danger-soft p-3 text-body-sm text-danger">
            <strong>{occupiedCount} bin(s) still hold stock.</strong> Transfer all stock out before deleting this zone.
          </div>
        ) : (
          <div className="rounded border border-warning bg-warning-soft p-3 text-body-sm text-warning">
            All bins are empty. This action cannot be undone.
          </div>
        )}
      </div>
      <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={submit}
          disabled={busy || occupiedCount > 0}
          className="border-danger text-danger hover:bg-danger hover:text-white"
        >
          {busy ? "Deleting…" : `Delete ${zoneBins.length} bins`}
        </Button>
      </div>
    </ModalShell>
  );
};

const RenameShelfModal = ({
  ctx,
  warehouses,
  onClose,
  onDone,
}: {
  ctx: ShelfCtx;
  warehouses: WarehouseRow[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) => {
  const [value, setValue] = useState(ctx.shelf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whId = resolveWhId(warehouses, ctx.warehouseCode);

  const submit = async () => {
    if (!whId) { setError("Warehouse not found."); return; }
    if (!/^[A-Za-z0-9-]{1,20}$/.test(value)) {
      setError("Shelf label must be 1-20 chars (letters / numbers / hyphen).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.renameShelf(whId, ctx.zone, ctx.shelf, value);
      onDone(`Shelf ${ctx.shelf} renamed to ${r.newShelf} (${r.updated} bins updated).`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Rename shelf"
      subtitle={`${ctx.warehouseCode} / Zone ${ctx.zone} / ${ctx.shelf}`}
      onClose={onClose}
    >
      {error && <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">{error}</div>}
      <div className="p-4 space-y-3">
        <div className="text-caption text-ink-muted uppercase font-semibold mb-1">New shelf label</div>
        <Input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder="S1" autoFocus />
        <div className="text-caption text-ink-muted">All bins on this shelf will be updated to the new label.</div>
      </div>
      <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Rename"}</Button>
      </div>
    </ModalShell>
  );
};

const DeleteShelfModal = ({
  ctx,
  warehouses,
  bins,
  onClose,
  onDone,
}: {
  ctx: ShelfCtx;
  warehouses: WarehouseRow[];
  bins: Bin[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whId = resolveWhId(warehouses, ctx.warehouseCode);
  const shelfBins = bins.filter(
    (b) => b.warehouse === ctx.warehouseCode && b.zone === ctx.zone && b.shelf === ctx.shelf
  );
  const occupiedCount = shelfBins.filter((b) => (b.qty ?? 0) > 0).length;

  const submit = async () => {
    if (!whId) { setError("Warehouse not found."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteShelf(whId, ctx.zone, ctx.shelf);
      onDone(`Shelf ${ctx.shelf} deleted (${r.deleted} bins removed).`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Delete shelf"
      subtitle={`${ctx.warehouseCode} / Zone ${ctx.zone} / ${ctx.shelf}`}
      onClose={onClose}
    >
      {error && <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">{error}</div>}
      <div className="p-4 space-y-2">
        <p className="text-body-sm">
          This will permanently delete all <strong>{shelfBins.length}</strong> bins on shelf <strong>{ctx.shelf}</strong>.
        </p>
        {occupiedCount > 0 ? (
          <div className="rounded border border-danger bg-danger-soft p-3 text-body-sm text-danger">
            <strong>{occupiedCount} bin(s) still hold stock.</strong> Transfer all stock out before deleting this shelf.
          </div>
        ) : (
          <div className="rounded border border-warning bg-warning-soft p-3 text-body-sm text-warning">
            All bins are empty. This action cannot be undone.
          </div>
        )}
      </div>
      <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={submit}
          disabled={busy || occupiedCount > 0}
          className="border-danger text-danger hover:bg-danger hover:text-white"
        >
          {busy ? "Deleting…" : `Delete ${shelfBins.length} bins`}
        </Button>
      </div>
    </ModalShell>
  );
};
