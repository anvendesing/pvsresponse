import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Map as MapIcon,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
  Warehouse as WHIcon,
  Zap,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Bin } from "@/data/types";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BinLayoutModal } from "@/components/warehouse/BinLayoutModal";

interface TreeNode {
  id: string;
  label: string;
  count: number;
  children?: TreeNode[];
  bin?: Bin;
}

const buildTree = (allBins: Bin[]): TreeNode[] => {
  const wMap = new Map<string, Map<string, Map<string, Map<string, Bin[]>>>>();
  // Track friendly name per warehouse code so the tree shows
  // "Main Warehouse · WH-MAIN" instead of a raw cuid.
  const whNames = new Map<string, string>();
  for (const b of allBins) {
    if (b.warehouseName) whNames.set(b.warehouse, b.warehouseName);
    const w = wMap.get(b.warehouse) ?? new Map();
    const z = w.get(b.zone) ?? new Map();
    const r = z.get(b.rack) ?? new Map();
    const list = r.get(b.shelf) ?? [];
    list.push(b);
    r.set(b.shelf, list);
    z.set(b.rack, r);
    w.set(b.zone, z);
    wMap.set(b.warehouse, w);
  }
  const tree: TreeNode[] = [];
  for (const [wh, zones] of wMap) {
    const friendly = whNames.get(wh);
    const label = friendly ? `${friendly} · ${wh}` : wh;
    const wNode: TreeNode = { id: wh, label, count: 0, children: [] };
    for (const [z, racks] of zones) {
      const zNode: TreeNode = { id: `${wh}-${z}`, label: `Zone ${z}`, count: 0, children: [] };
      for (const [r, shelves] of racks) {
        const rNode: TreeNode = {
          id: `${wh}-${z}-${r}`,
          label: r,
          count: 0,
          children: [],
        };
        for (const [s, ls] of shelves) {
          const sNode: TreeNode = {
            id: `${wh}-${z}-${r}-${s}`,
            label: s,
            count: ls.length,
            children: ls.map((b) => ({
              id: b.id,
              label: b.bin,
              count: b.qty ?? 0,
              bin: b,
            })),
          };
          rNode.children!.push(sNode);
          rNode.count += ls.length;
        }
        zNode.children!.push(rNode);
        zNode.count += rNode.count;
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
}

const NodeRow = ({ node, depth, expanded, toggle, onPick, selectedBin, filter }: NodeRowProps) => {
  const isLeaf = !!node.bin;
  const isOpen = expanded.has(node.id);
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

  return (
    <div>
      <button
        onClick={() => toggle(node.id)}
        className="w-full flex items-center gap-1 px-2 h-8 hover:bg-canvas text-body-sm font-medium text-ink transition-colors"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 text-left">{node.label}</span>
        <span className="text-caption text-ink-muted tnum">{node.count}</span>
      </button>
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

  // Bin layout (add/edit/delete) modal & banners.
  const [layoutMode, setLayoutMode] = useState<"single" | "bulk" | null>(null);
  const [editing, setEditing] = useState<Bin | null>(null);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshBins = async () => {
    await liveBins.refetch();
    await liveWarehouses.refetch();
  };

  const onDeleteBin = async (b: Bin) => {
    if (!confirm(`Delete bin ${b.zone}/${b.rack}/${b.shelf}/${b.bin}? This cannot be undone.`)) return;
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
      b.rack === selected.rack &&
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
          <div className="text-caption text-ink-muted font-mono">{r.productSku ?? ""}</div>
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
              icon={<Plus size={14} />}
              onClick={() => setLayoutMode("bulk")}
            >
              Add rack
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
            <Button variant="outline" size="sm" icon={<Layers size={14} />}>
              Putaway · F3
            </Button>
            <Button size="sm" icon={<Zap size={14} />}>
              Fast Transfer · F2
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

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
        <Kpi label="Bin Utilization" value={`${Math.round((occupiedBins / totalBins) * 100)}%`} delta={1.4} accent="primary" />
        <Kpi label="Bins Active" value={`${occupiedBins}/${totalBins}`} deltaSuffix="" accent="success" />
        <Kpi label="Pending Putaway" value="18" delta={-3} deltaSuffix="" accent="warning" />
        <Kpi label="Pending Pick" value="46" delta={5} deltaSuffix="" accent="primary" />
      </div>

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
              />
            ))}
          </div>
        </aside>

        {/* Right: bin contents + fast transfer */}
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            <div className="px-4 py-3 bg-surface border-b border-border flex items-center justify-between">
              <div>
                <div className="text-caption text-ink-muted uppercase">Selected location</div>
                <div className="font-mono text-h3 font-bold text-primary">
                  {selected
                    ? `${selected.warehouse} / Zone ${selected.zone} / ${selected.rack} / ${selected.shelf} / ${selected.bin}`
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

          {/* Fast transfer panel */}
          <aside className="w-[360px] bg-surface flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span className="text-h3 font-bold">Fast Transfer</span>
              </div>
              <div className="text-caption text-ink-muted mt-0.5">
                Scan → Source → Destination → Qty
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <ScanField label="1. Scan Product" value="FG-0031 — Finished Pump A2" done />
              <div className="grid grid-cols-2 gap-3 items-center">
                <ScanField label="2. Source Bin" value="WH-MAIN/A-1-2-B3" done compact />
                <div className="grid place-items-center text-primary">
                  <ArrowRight size={20} />
                </div>
              </div>
              <ScanField label="3. Destination Bin" value="WH-FG/B-1-3" done compact />
              <div>
                <div className="text-caption font-medium text-ink mb-1">4. Quantity</div>
                <div className="flex items-center gap-2">
                  <Input
                    size="md"
                    defaultValue="48"
                    className="!text-h3 !font-bold !tnum"
                  />
                  <Chip tone="neutral">PCS</Chip>
                </div>
              </div>
              <div className="bg-canvas border border-border rounded-md p-3 text-caption">
                <div className="font-semibold text-ink mb-1.5">Transfer summary</div>
                <Row k="Product" v="Finished Pump A2" />
                <Row k="From" v="WH-MAIN/A-1-2-B3" mono />
                <Row k="To" v="WH-FG/B-1-3" mono />
                <Row k="Quantity" v="48 PCS" />
                <Row k="Source available" v="92 PCS" />
              </div>
            </div>
            <div className="border-t border-border p-3 grid grid-cols-2 gap-2">
              <Button variant="outline" size="md" icon={<ScanLine size={14} />}>
                Re-scan
              </Button>
              <Button size="md">Complete · F8</Button>
            </div>
          </aside>
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
                  rack: layoutMode === "single" ? selected.rack : undefined,
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
    </div>
  );
};

// Lightweight inline editor for a single bin: rename + capacity.
// Warehouse / zone / rack / shelf are immutable to keep stock-ledger
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
            {bin.warehouse} / {bin.zone} / {bin.rack} / {bin.shelf} / {bin.bin}
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

const ScanField = ({
  label,
  value,
  done,
  compact,
}: {
  label: string;
  value: string;
  done?: boolean;
  compact?: boolean;
}) => (
  <div>
    <div className="text-caption font-medium text-ink mb-1">{label}</div>
    <div
      className={cn(
        "border-2 rounded-md flex items-center gap-2 px-3",
        compact ? "h-9" : "h-11",
        done ? "border-success bg-success-soft" : "border-dashed border-border bg-canvas"
      )}
    >
      <ScanLine size={14} className={done ? "text-success" : "text-primary"} />
      <span className={cn("font-mono text-body-sm truncate", done ? "text-success font-semibold" : "text-ink-muted")}>
        {value}
      </span>
    </div>
  </div>
);

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex items-center justify-between py-0.5">
    <span className="text-ink-muted">{k}</span>
    <span className={mono ? "font-mono font-semibold text-ink" : "font-semibold text-ink"}>{v}</span>
  </div>
);
