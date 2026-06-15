// Multi-container packing panel.
//
// Sits inside the desktop PackingSlipEditor below the line table. The
// packer creates one container per physical box / bag / sack, allocates
// items into it (a single line can be split across multiple containers
// — that's the whole point), optionally records a scale reading, and
// then seals. /pack on the slip is gated on every packed unit being
// allocated to a sealed container when the multi-container flag is on.
//
// The panel re-fetches containers after every mutation so the est-
// weight chip stays in sync with the server-side recompute hook (we
// could derive on the client but the server is canonical and runs
// the same parseSizeToKg fallback for unweighed items).

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Lock,
  Package,
  Plus,
  Scale,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { cn } from "@/lib/cn";
import { primaryScanCode } from "@/lib/scanCode";
import {
  api,
  type ContainerKind,
  type ContainerTypeRow,
  type PackingContainerRow,
  type PackingSlipItemRow,
} from "@/lib/api";

interface Props {
  slipId: string;
  status: "open" | "packed" | "invoiced" | "cancelled";
  items: PackingSlipItemRow[];
  /** Confirmation toggle from CompanyProfile (defaults true). */
  requireSealConfirmation?: boolean;
  /** Bubble container change back so parent can refresh totals chip. */
  onChanged?: (next: PackingContainerRow[]) => void;
}

const kindIcon = (k: ContainerKind | undefined) => {
  switch (k) {
    case "bag":
      return Briefcase;
    case "carton":
    case "box":
      return Box;
    case "sack":
      return Package;
    default:
      return Layers;
  }
};

const fmtKg = (n: number | null | undefined) =>
  n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(2)} kg`;

export const PackingContainersPanel = ({
  slipId,
  status,
  items,
  requireSealConfirmation = true,
  onChanged,
}: Props) => {
  const [containers, setContainers] = useState<PackingContainerRow[]>([]);
  const [types, setTypes] = useState<ContainerTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sealConfirm, setSealConfirm] = useState<PackingContainerRow | null>(null);

  const isEditable = status === "open";

  const refresh = async () => {
    setLoading(true);
    try {
      const [cs, ts] = await Promise.all([
        api.packingContainers(slipId),
        api.containerTypes().catch(() => [] as ContainerTypeRow[]),
      ]);
      setContainers(cs);
      setTypes(ts.filter((t) => t.active));
      onChanged?.(cs);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slipId]);

  // Auto-expand any open, empty container so the "Add item" picker is
  // immediately visible. Without this, packers click "Add container",
  // see a collapsed row, and don't realise the header is a toggle.
  useEffect(() => {
    if (containers.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let mutated = false;
      for (const c of containers) {
        if (c.status === "open" && c.items.length === 0 && !next.has(c.id)) {
          next.add(c.id);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [containers]);

  // qty already allocated per slip-line across every container — drives
  // the "X of Y" chip on each container row and the "remaining" hint
  // on the add-item picker so the packer never over-allocates.
  const allocPerLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of containers) {
      for (const it of c.items) {
        m.set(
          it.packingSlipItemId,
          (m.get(it.packingSlipItemId) ?? 0) + it.qty
        );
      }
    }
    return m;
  }, [containers]);

  const totalEst = containers.reduce((s, c) => s + c.estWeightKg, 0);
  const anyActual = containers.some((c) => c.actualWeightKg != null);
  const totalActual = anyActual
    ? containers.reduce((s, c) => s + (c.actualWeightKg ?? c.estWeightKg), 0)
    : null;
  const sealedCount = containers.filter((c) => c.status === "sealed").length;

  const totalPacked = items.reduce((s, it) => s + it.qtyPacked, 0);
  const totalAllocated = Array.from(allocPerLine.values()).reduce(
    (s, q) => s + q,
    0
  );
  const remaining = Math.max(0, totalPacked - totalAllocated);

  const createContainer = async (containerTypeId?: string | null) => {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createPackingContainer(slipId, {
        containerTypeId: containerTypeId ?? null,
      });
      setExpanded((prev) => new Set(prev).add(created.id));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const removeContainer = async (c: PackingContainerRow) => {
    if (
      !confirm(
        `Remove container ${c.label}? Its ${c.items.length} item allocation${
          c.items.length === 1 ? "" : "s"
        } will be released back to the unallocated pool.`
      )
    ) {
      return;
    }
    setBusyId(c.id);
    try {
      await api.deletePackingContainer(slipId, c.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const changeType = async (c: PackingContainerRow, typeId: string | null) => {
    setBusyId(c.id);
    try {
      await api.updatePackingContainer(slipId, c.id, { containerTypeId: typeId });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const setActualWeight = async (c: PackingContainerRow, kg: number | null) => {
    setBusyId(c.id);
    try {
      await api.updatePackingContainer(slipId, c.id, { actualWeightKg: kg });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const requestSeal = (c: PackingContainerRow) => {
    if (c.items.length === 0) {
      setError(`Container ${c.label} is empty — allocate at least one item before sealing.`);
      return;
    }
    if (requireSealConfirmation) {
      setSealConfirm(c);
    } else {
      void doSeal(c, c.actualWeightKg ?? null);
    }
  };

  const doSeal = async (c: PackingContainerRow, actualKg: number | null) => {
    setBusyId(c.id);
    try {
      await api.sealPackingContainer(slipId, c.id, { actualWeightKg: actualKg });
      setSealConfirm(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const unseal = async (c: PackingContainerRow) => {
    setBusyId(c.id);
    try {
      await api.unsealPackingContainer(slipId, c.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-caption text-ink-muted uppercase font-semibold flex items-center gap-2">
          Containers
          {containers.length > 0 && (
            <Chip size="sm" tone="neutral">
              {sealedCount}/{containers.length} sealed
            </Chip>
          )}
          <Chip size="sm" tone={remaining > 0 ? "warning" : "success"}>
            allocated {totalAllocated} / {totalPacked}
          </Chip>
          <Chip size="sm" tone="info">
            est {fmtKg(totalEst)}
            {totalActual != null ? ` · actual ${fmtKg(totalActual)}` : ""}
          </Chip>
        </div>
        {isEditable && (
          <div className="flex items-center gap-1">
            <TypePicker
              types={types}
              disabled={creating || types.length === 0}
              onPick={(t) => void createContainer(t)}
              label="Add container"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 bg-danger-soft border border-danger text-danger rounded-md px-3 py-2 text-body-sm flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-caption">
            <X size={12} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-caption text-ink-muted py-6 text-center">Loading containers…</div>
      ) : containers.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-4 text-center text-caption text-ink-muted">
          No containers yet.
          {isEditable
            ? " Add one above for each physical box / bag / sack the order ships in."
            : " This slip was packed before multi-container tracking was enabled."}
        </div>
      ) : (
        <div className="space-y-2">
          {containers.map((c) => (
            <ContainerCard
              key={c.id}
              container={c}
              items={items}
              allocPerLine={allocPerLine}
              types={types}
              expanded={expanded.has(c.id)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
              busy={busyId === c.id}
              editable={isEditable}
              onChangeType={(tid) => void changeType(c, tid)}
              onSetActual={(kg) => void setActualWeight(c, kg)}
              onSeal={() => requestSeal(c)}
              onUnseal={() => void unseal(c)}
              onDelete={() => void removeContainer(c)}
              onItemsChanged={() => void refresh()}
              slipId={slipId}
            />
          ))}
        </div>
      )}

      {sealConfirm && (
        <SealConfirmModal
          container={sealConfirm}
          onCancel={() => setSealConfirm(null)}
          onConfirm={(kg) => void doSeal(sealConfirm, kg)}
        />
      )}
    </div>
  );
};

// ============================================================ Type picker ===

interface TypePickerProps {
  types: ContainerTypeRow[];
  disabled?: boolean;
  onPick: (id: string | null) => void;
  label: string;
}

const TypePicker = ({ types, disabled, onPick, label }: TypePickerProps) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        size="sm"
        icon={<Plus size={14} />}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        {label}
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-1 z-20 bg-surface border border-border rounded-md elevation-2 min-w-[240px] max-h-80 overflow-y-auto">
            <div className="px-3 py-2 text-caption text-ink-muted uppercase font-semibold border-b border-border">
              Choose container type
            </div>
            {types.length === 0 ? (
              <div className="px-3 py-3 text-caption text-ink-muted">
                No container types configured. Set them up in Settings →
                Container types.
              </div>
            ) : (
              types.map((t) => {
                const Icon = kindIcon(t.kind);
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onPick(t.id);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-canvas flex items-center gap-2"
                  >
                    <Icon size={16} className="text-ink-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-body-sm font-semibold truncate">
                        {t.name}
                      </div>
                      <div className="text-caption text-ink-muted">
                        {t.code} · tare {fmtKg(t.tareKg)}
                        {t.maxKg ? ` · max ${fmtKg(t.maxKg)}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
            <button
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-canvas border-t border-border text-caption text-ink-muted"
            >
              No type / decide later
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ========================================================= ContainerCard ===

interface ContainerCardProps {
  container: PackingContainerRow;
  items: PackingSlipItemRow[];
  allocPerLine: Map<string, number>;
  types: ContainerTypeRow[];
  expanded: boolean;
  busy: boolean;
  editable: boolean;
  slipId: string;
  onToggle: () => void;
  onChangeType: (id: string | null) => void;
  onSetActual: (kg: number | null) => void;
  onSeal: () => void;
  onUnseal: () => void;
  onDelete: () => void;
  onItemsChanged: () => void;
}

const ContainerCard = ({
  container,
  items,
  allocPerLine,
  types,
  expanded,
  busy,
  editable,
  slipId,
  onToggle,
  onChangeType,
  onSetActual,
  onSeal,
  onUnseal,
  onDelete,
  onItemsChanged,
}: ContainerCardProps) => {
  const Icon = kindIcon(container.containerType?.kind);
  const isSealed = container.status === "sealed";
  const isLockedForEdits = !editable || isSealed;
  const myItems = container.items;
  const myItemCount = myItems.length;
  const myQty = myItems.reduce((s, ci) => s + ci.qty, 0);

  return (
    <div
      className={cn(
        "border rounded-md transition-colors",
        isSealed ? "border-success bg-success-soft/40" : "border-border bg-canvas"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 hover:bg-primary/5 -mx-1 px-1 rounded transition-colors"
          title={expanded ? "Collapse — hide contents and add picker" : "Expand to add items and seal"}
        >
          {expanded ? (
            <ChevronDown size={16} className="text-ink-muted shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-ink-muted shrink-0" />
          )}
          <span className="font-mono font-bold text-h3 tnum text-primary">
            {container.label}
          </span>
          <Icon size={18} className="text-ink-muted shrink-0" />
          <span className="font-semibold truncate">
            {container.containerType?.name ?? "No type"}
          </span>
          <Chip size="sm" tone={isSealed ? "success" : "primary"}>
            {isSealed ? (
              <span className="flex items-center gap-1">
                <Lock size={10} /> sealed
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Unlock size={10} /> open
              </span>
            )}
          </Chip>
          <Chip size="sm" tone="neutral">
            {myItemCount} item{myItemCount === 1 ? "" : "s"} · {myQty} units
          </Chip>
          <Chip size="sm" tone="info">
            est {fmtKg(container.estWeightKg)}
            {container.actualWeightKg != null
              ? ` · actual ${fmtKg(container.actualWeightKg)}`
              : ""}
          </Chip>
        </button>
        {editable && (
          <div className="flex items-center gap-1 shrink-0">
            {isSealed ? (
              <Button
                size="sm"
                variant="outline"
                icon={<Unlock size={14} />}
                onClick={onUnseal}
                disabled={busy}
              >
                Unseal
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={<CheckCircle2 size={14} />}
                onClick={onSeal}
                disabled={busy}
              >
                Seal
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={onDelete}
              disabled={busy}
              className="text-danger hover:bg-danger-soft"
              title="Remove container"
            >
              {""}
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/70">
          {!isLockedForEdits && (
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="text-caption text-ink-muted block mb-1">
                  Container type
                </label>
                <select
                  className="h-8 w-full text-body-sm border border-border rounded-md px-2 bg-white"
                  value={container.containerTypeId ?? ""}
                  onChange={(e) => onChangeType(e.target.value || null)}
                  disabled={busy}
                >
                  <option value="">(none)</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (tare {fmtKg(t.tareKg)})
                    </option>
                  ))}
                </select>
              </div>
              <ActualWeightField
                value={container.actualWeightKg ?? null}
                onSave={onSetActual}
                disabled={busy}
              />
            </div>
          )}

          <div className="mt-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Items in this container
            </div>
            {myItems.length === 0 ? (
              <div className="text-caption text-ink-muted py-3 text-center border border-dashed border-border rounded-md">
                No items yet.
                {!isLockedForEdits
                  ? " Use the “Add item” picker below to allocate qty from a packed line into this container."
                  : ""}
              </div>
            ) : (
              <div className="space-y-1">
                {myItems.map((ci) => {
                  const line = items.find((it) => it.id === ci.packingSlipItemId);
                  const code = ci.packingSlipItem?.variant
                    ? primaryScanCode(ci.packingSlipItem.variant)
                    : primaryScanCode(
                        ci.packingSlipItem?.product ?? { sku: "—", barcode: null }
                      );
                  return (
                    <div
                      key={ci.id}
                      className="flex items-center gap-2 text-body-sm bg-white/70 rounded px-2 py-1"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold truncate block">
                          {line?.product?.name ?? "—"}
                        </span>
                        <span className="text-caption text-ink-muted font-mono">
                          {code}
                        </span>
                      </span>
                      {isLockedForEdits ? (
                        <Chip size="sm" tone="neutral">
                          {ci.qty}
                        </Chip>
                      ) : (
                        <QtyInput
                          value={ci.qty}
                          max={
                            (line?.qtyPacked ?? Number.POSITIVE_INFINITY) -
                            ((allocPerLine.get(ci.packingSlipItemId) ?? 0) - ci.qty)
                          }
                          onChange={async (nextQty) => {
                            try {
                              if (nextQty <= 0) {
                                await api.deletePackingContainerItem(
                                  slipId,
                                  container.id,
                                  ci.id
                                );
                              } else {
                                await api.updatePackingContainerItem(
                                  slipId,
                                  container.id,
                                  ci.id,
                                  { qty: nextQty }
                                );
                              }
                              onItemsChanged();
                            } catch {
                              onItemsChanged();
                            }
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isLockedForEdits && (
              <AddItemRow
                items={items}
                allocPerLine={allocPerLine}
                onAdd={async (lineId, qty) => {
                  await api.addPackingContainerItem(slipId, container.id, {
                    packingSlipItemId: lineId,
                    qty,
                  });
                  onItemsChanged();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// =========================================================== small bits ===

const ActualWeightField = ({
  value,
  onSave,
  disabled,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  disabled?: boolean;
}) => {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);
  return (
    <div className="min-w-[200px]">
      <label className="text-caption text-ink-muted block mb-1 flex items-center gap-1">
        <Scale size={12} /> Actual weight (kg)
      </label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="!h-8 tnum"
          placeholder="optional"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const n = draft.trim() === "" ? null : Number(draft);
            onSave(n != null && Number.isFinite(n) ? n : null);
          }}
          disabled={disabled}
        >
          Save
        </Button>
      </div>
    </div>
  );
};

const QtyInput = ({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <input
      type="number"
      className="h-7 w-20 text-right tnum text-body-sm border border-border rounded-md px-2 bg-white"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Math.max(0, Math.min(max, Number(draft) || 0));
        if (n !== value) onChange(n);
      }}
    />
  );
};

interface AddItemRowProps {
  items: PackingSlipItemRow[];
  allocPerLine: Map<string, number>;
  onAdd: (lineId: string, qty: number) => Promise<void>;
}

const AddItemRow = ({ items, allocPerLine, onAdd }: AddItemRowProps) => {
  // Distinguish two empty states:
  //   1. anyPacked === false → packer hasn't set qtyPacked on any line
  //      yet. The picker can't show anything — point them at the line
  //      table above instead.
  //   2. anyPacked === true and remainingByLine empty → every unit is
  //      already in a container.
  const anyPacked = items.some((it) => it.qtyPacked > 0);
  const remainingByLine = useMemo(
    () =>
      items
        .filter((it) => it.qtyPacked > 0)
        .map((it) => ({
          item: it,
          remaining: Math.max(
            0,
            it.qtyPacked - (allocPerLine.get(it.id) ?? 0)
          ),
        }))
        .filter((r) => r.remaining > 0),
    [items, allocPerLine]
  );
  const [pickedId, setPickedId] = useState<string>("");
  const [qty, setQty] = useState<string>("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (remainingByLine.length > 0 && !remainingByLine.find((r) => r.item.id === pickedId)) {
      setPickedId(remainingByLine[0].item.id);
    } else if (remainingByLine.length === 0) {
      setPickedId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingByLine.length]);

  if (!anyPacked) {
    return (
      <div className="mt-2 bg-warning-soft border border-warning text-ink rounded-md px-3 py-2 text-caption">
        <strong>Set the Packed qty first.</strong> In the line-items table above, type how many
        units of each line you’re putting in boxes (it defaults to the picked qty). Only lines with
        <span className="font-mono"> Packed &gt; 0</span> are eligible for container allocation.
      </div>
    );
  }

  if (remainingByLine.length === 0) {
    return (
      <div className="mt-2 text-caption text-success flex items-center gap-1">
        <CheckCircle2 size={12} /> Every packed unit is allocated.
      </div>
    );
  }

  const picked = remainingByLine.find((r) => r.item.id === pickedId);
  const max = picked?.remaining ?? 0;

  return (
    <div className="mt-2 flex items-end gap-2">
      <div className="flex-1">
        <label className="text-caption text-ink-muted block mb-1">Add item</label>
        <select
          className="h-8 w-full text-body-sm border border-border rounded-md px-2 bg-white"
          value={pickedId}
          onChange={(e) => {
            setPickedId(e.target.value);
            setQty("1");
          }}
        >
          {remainingByLine.map(({ item, remaining }) => {
            const code = item.variant
              ? primaryScanCode(item.variant)
              : primaryScanCode(item.product ?? { sku: "—", barcode: null });
            return (
              <option key={item.id} value={item.id}>
                {item.product?.name} · {code} · {remaining} left
              </option>
            );
          })}
        </select>
      </div>
      <div className="w-24">
        <label className="text-caption text-ink-muted block mb-1">Qty</label>
        <Input
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="!h-8 tnum"
        />
      </div>
      <Button
        size="sm"
        onClick={async () => {
          if (!pickedId) return;
          const q = Math.max(0, Math.min(max, Number(qty) || 0));
          if (q <= 0) return;
          setBusy(true);
          try {
            await onAdd(pickedId, q);
            setQty("1");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy || !pickedId || max <= 0}
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          if (!pickedId) return;
          setBusy(true);
          try {
            await onAdd(pickedId, max);
            setQty("1");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy || !pickedId || max <= 0}
        title="Allocate the remaining qty into this container"
      >
        All ({max})
      </Button>
    </div>
  );
};

// ========================================================= seal confirm ===

interface SealConfirmModalProps {
  container: PackingContainerRow;
  onCancel: () => void;
  onConfirm: (actualKg: number | null) => void;
}

const SealConfirmModal = ({ container, onCancel, onConfirm }: SealConfirmModalProps) => {
  const [actual, setActual] = useState(
    container.actualWeightKg == null ? "" : String(container.actualWeightKg)
  );
  const itemCount = container.items.length;
  const unitCount = container.items.reduce((s, ci) => s + ci.qty, 0);
  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface w-full max-w-md rounded-md elevation-3 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-h3 font-bold mb-1 flex items-center gap-2">
          <Lock size={18} /> Seal container {container.label}
        </div>
        <div className="text-body-sm text-ink-muted mb-3">
          Confirm that you've finished packing this container. Once
          sealed, items inside cannot be changed without re-opening it.
        </div>
        <div className="border border-border rounded-md p-3 bg-canvas space-y-1 text-body-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Type</span>
            <span className="font-semibold">
              {container.containerType?.name ?? "No type"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Items</span>
            <span className="tnum font-semibold">
              {itemCount} lines · {unitCount} units
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Estimated weight</span>
            <span className="tnum font-semibold">{fmtKg(container.estWeightKg)}</span>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-caption text-ink-muted block mb-1 flex items-center gap-1">
            <Scale size={12} /> Actual weight from scale (kg) — optional but recommended
          </label>
          <Input
            type="number"
            step="0.01"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder={`Default: estimated ${fmtKg(container.estWeightKg)}`}
            className="tnum"
          />
        </div>
        <div className="mt-4 flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<Lock size={14} />}
            onClick={() => {
              const n = actual.trim() === "" ? null : Number(actual);
              onConfirm(n != null && Number.isFinite(n) ? n : null);
            }}
          >
            Seal container
          </Button>
        </div>
      </div>
    </div>
  );
};
