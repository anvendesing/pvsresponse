// Drawer for working a pick list. Each Sales Order line can be split
// across one or more bins (multi-location picking). The system seeds
// suggested splits at creation time; the operator can add another bin,
// remove an unused split, change which bin a split points at, and edit
// the picked qty per row. Completing reserves stock per bin and rolls
// the rows up into a single Packing Slip line per SO line.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Plus,
  Printer,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  ApiError,
  type BinSummary,
  type PackingSlipRow,
  type PickListItemRow,
  type PickListRow,
  type PickListStatus,
} from "@/lib/api";
import { cn } from "@/lib/cn";

interface Props {
  pickListId: string;
  onClose: () => void;
  onCompleted?: (packingSlip: PackingSlipRow) => void;
  onChanged?: () => void;
}

const statusTone = (s: PickListStatus): "neutral" | "primary" | "success" | "danger" => {
  switch (s) {
    case "draft":
      return "neutral";
    case "picking":
      return "primary";
    case "picked":
      return "success";
    case "cancelled":
      return "danger";
  }
};

const binLabel = (b: BinSummary | undefined | null) =>
  b ? `${b.zone}-${b.rack}-${b.shelf}-${b.bin}` : "(no bin)";

interface LineDraft {
  binId: string | null;
  qtyToPick: number;
  qtyPicked: number;
}

export const PickListEditor = ({ pickListId, onClose, onCompleted, onChanged }: Props) => {
  const [pl, setPl] = useState<PickListRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<{ itemId: string; reason: string }[]>([]);
  // Per-line shortfall details from the auto-pick endpoint. Each entry
  // explains why a line couldn't be filled to qtyToPick (no bin, bin
  // out of free qty, or variant stock cap). The UI tints the affected
  // rows amber + shows a banner with a "Complete partial pick" button.
  const [shortfalls, setShortfalls] = useState<
    {
      itemId: string;
      sku: string;
      requested: number;
      filled: number;
      reason: "no_bin" | "bin_capped" | "variant_capped";
      location?: string | null;
    }[]
  >([]);
  // Available bins per product, used to populate the dropdown so the
  // operator can pick from a different rack than the system suggested.
  const [binChoices, setBinChoices] = useState<Record<string, BinSummary[]>>({});
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});

  const applyPickList = (fresh: PickListRow) => {
    setPl(fresh);
    setDrafts(
      Object.fromEntries(
        fresh.items.map((it) => [
          it.id,
          {
            binId: it.binId ?? null,
            qtyToPick: it.qtyToPick,
            qtyPicked: it.qtyPicked,
          },
        ])
      )
    );
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const fresh = await api.pickList(pickListId);
      applyPickList(fresh);
      setError(null);

      const productIds = Array.from(new Set(fresh.items.map((it) => it.productId)));
      const map: Record<string, BinSummary[]> = {};
      for (const pid of productIds) {
        try {
          map[pid] = await api.binsForProduct(pid);
        } catch {
          map[pid] = [];
        }
      }
      setBinChoices(map);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickListId]);

  const updateLine = (id: string, patch: Partial<LineDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Group items by salesOrderItemId so we can show one card per ordered
  // SKU and stack the bin splits inside it.
  const groups = useMemo(() => {
    if (!pl) return [] as { soItemId: string; rows: PickListItemRow[] }[];
    const map = new Map<string, PickListItemRow[]>();
    for (const it of pl.items) {
      const key = it.salesOrderItemId;
      const arr = map.get(key);
      if (arr) arr.push(it);
      else map.set(key, [it]);
    }
    return Array.from(map, ([soItemId, rows]) => ({ soItemId, rows }));
  }, [pl]);

  const totalToPick = useMemo(
    () => Object.values(drafts).reduce((s, d) => s + (d.qtyToPick || 0), 0),
    [drafts]
  );
  const totalPicked = useMemo(
    () => Object.values(drafts).reduce((s, d) => s + (d.qtyPicked || 0), 0),
    [drafts]
  );

  const isLocked = pl && (pl.status === "picked" || pl.status === "cancelled");

  // Save edits to existing rows. Add/remove rows go through dedicated
  // endpoints below so we don't need to round-trip the full items array.
  const saveDrafts = async () => {
    if (!pl) return null;
    const items = Object.entries(drafts).map(([id, d]) => ({
      id,
      binId: d.binId,
      qtyToPick: d.qtyToPick,
      qtyPicked: d.qtyPicked,
    }));
    return api.updatePickList(pl.id, { items });
  };

  const save = async () => {
    if (!pl || isLocked) return;
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const updated = await saveDrafts();
      if (updated) applyPickList(updated);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addSplit = async (soItemId: string, productId: string) => {
    if (!pl || isLocked) return;
    setBusy(true);
    setError(null);
    try {
      // Persist current edits first so the operator doesn't lose any
      // qty changes when we re-fetch the pick list.
      await saveDrafts();
      // Pick a sensible default bin: the first one with free qty that
      // isn't already assigned to another split on the same SO line.
      const usedBins = new Set(
        pl.items
          .filter((i) => i.salesOrderItemId === soItemId)
          .map((i) => i.binId)
          .filter(Boolean) as string[]
      );
      const candidate =
        (binChoices[productId] ?? []).find(
          (b) => !usedBins.has(b.id) && b.qty - b.reservedQty > 0
        ) ?? null;
      const updated = await api.addPickListItem(pl.id, {
        salesOrderItemId: soItemId,
        binId: candidate?.id ?? null,
        qtyToPick: 0,
      });
      applyPickList(updated);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeSplit = async (itemId: string) => {
    if (!pl || isLocked) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.removePickListItem(pl.id, itemId);
      applyPickList(updated);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!pl || isLocked) return;
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await saveDrafts();
      const result = await api.completePickList(pl.id);
      onChanged?.();
      onCompleted?.(result.packingSlip);
      onClose();
    } catch (e) {
      const err = e as { details?: { details?: typeof issues }; message?: string };
      const det = err.details?.details;
      if (Array.isArray(det)) setIssues(det);
      setError(err.message ?? "Complete failed.");
    } finally {
      setBusy(false);
    }
  };

  // One-click pick: server fills qtyPicked greedily and completes the
  // list. If it falls short, we surface the per-line shortfalls in the
  // banner and let the operator re-trigger with acceptShortfall=true.
  const autoPick = async (acceptShortfall = false) => {
    if (!pl || isLocked) return;
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const result = await api.autoPickList(pl.id, { acceptShortfall });
      setShortfalls(result.shortfalls ?? []);
      onChanged?.();
      onCompleted?.(result.packingSlip);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const det = e.details as
          | {
              code?: string;
              details?: {
                shortfalls?: typeof shortfalls;
                pickList?: PickListRow;
              };
            }
          | undefined;
        if (det?.code === "auto_pick_partial" && det.details) {
          if (det.details.pickList) applyPickList(det.details.pickList);
          setShortfalls(det.details.shortfalls ?? []);
          setError(e.message);
          return;
        }
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const printPickList = () => {
    if (!pl) return;
    window.open(`/print/pick-list/${pl.id}?print=1`, "_blank", "noopener");
  };

  const cancel = async () => {
    if (!pl || pl.status === "picked" || pl.status === "cancelled") return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelPickList(pl.id);
      onChanged?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-4xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">Pick List</div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {pl?.pickListNo ?? "…"}
              {pl && (
                <Chip size="sm" tone={statusTone(pl.status)} className="capitalize">
                  {pl.status}
                </Chip>
              )}
              {pl?.salesOrder && (
                <Chip size="sm" tone="info">
                  {pl.salesOrder.soNo} · {pl.salesOrder.customer?.name}
                </Chip>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 grid place-items-center text-ink-muted">Loading…</div>
        ) : error && !pl ? (
          <div className="flex-1 grid place-items-center text-danger">{error}</div>
        ) : pl ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
                  {error}
                </div>
              )}
              {shortfalls.length > 0 && (
                <div className="bg-warning-soft border border-warning rounded-md p-3 text-body-sm">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-ink">
                        {shortfalls.length} line{shortfalls.length === 1 ? "" : "s"} couldn't be auto-filled
                      </div>
                      <div className="text-caption text-ink-muted">
                        Stock is short on the rows below. Each row has been
                        filled to the maximum possible. Choose to complete a
                        partial pick or amend bin counts and retry.
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {shortfalls.map((s) => (
                      <div
                        key={s.itemId}
                        className="flex items-center justify-between gap-3 bg-white/60 rounded px-2 py-1 text-caption"
                      >
                        <span className="font-mono font-semibold">
                          {s.sku}
                          {s.location && (
                            <span className="ml-1 text-ink-muted font-normal">
                              · bin {s.location}
                            </span>
                          )}
                          <span className="ml-1 text-ink-muted font-normal">
                            ({s.reason.replace("_", " ")})
                          </span>
                        </span>
                        <span>
                          requested <b className="tnum">{s.requested}</b> ·
                          filled <b className="tnum">{s.filled}</b> · short by{" "}
                          <b className="tnum text-danger">
                            {s.requested - s.filled}
                          </b>
                        </span>
                      </div>
                    ))}
                  </div>
                  {!isLocked && (
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<CheckCircle2 size={14} />}
                        onClick={() => autoPick(true)}
                        disabled={busy}
                      >
                        Complete partial pick
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShortfalls([])}
                        disabled={busy}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <Card label="SO lines">
                  <div className="text-h3 font-bold tnum">{groups.length}</div>
                </Card>
                <Card label="Total to pick">
                  <div className="text-h3 font-bold tnum">{totalToPick}</div>
                </Card>
                <Card label="Picked so far">
                  <div className="text-h3 font-bold tnum text-primary">{totalPicked}</div>
                </Card>
              </div>

              <div className="space-y-3">
                {groups.map((g) => {
                  const head = g.rows[0];
                  const choices = binChoices[head.productId] ?? [];
                  const lineToPick = g.rows.reduce(
                    (s, r) => s + (drafts[r.id]?.qtyToPick ?? r.qtyToPick),
                    0
                  );
                  const linePicked = g.rows.reduce(
                    (s, r) => s + (drafts[r.id]?.qtyPicked ?? r.qtyPicked),
                    0
                  );
                  return (
                    <div
                      key={g.soItemId}
                      className="border border-border rounded-md overflow-hidden"
                    >
                      <div className="grid grid-cols-12 items-center px-3 py-2 bg-canvas border-b border-border">
                        <div className="col-span-7">
                          <div className="font-semibold text-body-sm">
                            {head.product?.name}
                          </div>
                          <div className="text-caption text-ink-muted font-mono">
                            {head.variant?.sku ?? head.product?.sku}
                            {head.variant &&
                              (head.variant.size || head.variant.color || head.variant.grade) && (
                                <span className="ml-2">
                                  ·{" "}
                                  {[
                                    head.variant.size,
                                    head.variant.color,
                                    head.variant.grade,
                                  ]
                                    .filter(Boolean)
                                    .join(" / ")}
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="col-span-2 text-right">
                          <div className="text-caption text-ink-muted uppercase">To pick</div>
                          <div className="tnum font-semibold">{lineToPick}</div>
                        </div>
                        <div className="col-span-2 text-right">
                          <div className="text-caption text-ink-muted uppercase">Picked</div>
                          <div
                            className={cn(
                              "tnum font-semibold",
                              linePicked < lineToPick
                                ? "text-warning"
                                : "text-primary"
                            )}
                          >
                            {linePicked}
                          </div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-caption text-ink-muted uppercase">Stock</div>
                          <div className="tnum text-ink-muted">
                            {head.variant?.stockOnHand ?? head.product?.stockOnHand ?? 0}
                          </div>
                        </div>
                      </div>

                      <div className="divide-y divide-border">
                        {g.rows.map((it) => {
                          const draft = drafts[it.id] ?? {
                            binId: it.binId ?? null,
                            qtyToPick: it.qtyToPick,
                            qtyPicked: it.qtyPicked,
                          };
                          const issue = issues.find((x) => x.itemId === it.id);
                          const shortfall = shortfalls.find((x) => x.itemId === it.id);
                          const canRemove = g.rows.length > 1;
                          return (
                            <div
                              key={it.id}
                              className={cn(
                                "grid grid-cols-12 items-center gap-2 px-3 py-2 text-body-sm",
                                issue && "bg-danger-soft",
                                !issue && shortfall && "bg-warning-soft"
                              )}
                            >
                              <div className="col-span-6">
                                <select
                                  disabled={!!isLocked}
                                  value={draft.binId ?? ""}
                                  onChange={(e) =>
                                    updateLine(it.id, {
                                      binId: e.target.value || null,
                                    })
                                  }
                                  className="h-8 w-full bg-surface border border-border rounded-md px-2 text-body-sm font-mono"
                                >
                                  <option value="">— choose bin —</option>
                                  {choices.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {binLabel(b)} (free {b.qty - b.reservedQty})
                                    </option>
                                  ))}
                                  {it.bin && !choices.find((c) => c.id === it.bin?.id) && (
                                    <option value={it.bin.id}>
                                      {binLabel(it.bin)} (free {it.bin.qty - it.bin.reservedQty})
                                    </option>
                                  )}
                                </select>
                                {draft.binId && (
                                  <div className="text-caption text-ink-muted mt-0.5 font-mono flex items-center gap-1">
                                    <MapPin size={11} />{" "}
                                    {binLabel(
                                      choices.find((c) => c.id === draft.binId) ??
                                        (draft.binId === it.bin?.id ? it.bin : null)
                                    )}
                                  </div>
                                )}
                                {issue && (
                                  <div className="text-caption text-danger mt-0.5">
                                    {issue.reason}
                                  </div>
                                )}
                                {!issue && shortfall && (
                                  <div className="text-caption text-warning mt-0.5">
                                    short by {shortfall.requested - shortfall.filled} ·{" "}
                                    {shortfall.reason.replace("_", " ")}
                                  </div>
                                )}
                              </div>
                              <div className="col-span-2">
                                <Input
                                  type="number"
                                  disabled={!!isLocked}
                                  value={String(draft.qtyToPick)}
                                  onChange={(e) =>
                                    updateLine(it.id, {
                                      qtyToPick: Math.max(0, Number(e.target.value)),
                                    })
                                  }
                                  className="!h-7 !text-right tnum"
                                  aria-label="Qty to pick"
                                />
                                <div className="text-caption text-ink-muted text-right mt-0.5">
                                  to pick
                                </div>
                              </div>
                              <div className="col-span-3">
                                <Input
                                  type="number"
                                  disabled={!!isLocked}
                                  value={String(draft.qtyPicked)}
                                  onChange={(e) =>
                                    updateLine(it.id, {
                                      qtyPicked: Math.max(0, Number(e.target.value)),
                                    })
                                  }
                                  className="!h-7 !text-right tnum"
                                  aria-label="Qty picked"
                                />
                                <div className="text-caption text-ink-muted text-right mt-0.5">
                                  picked
                                </div>
                              </div>
                              <div className="col-span-1 text-right">
                                {!isLocked && canRemove && (
                                  <button
                                    onClick={() => removeSplit(it.id)}
                                    disabled={busy}
                                    title="Remove this split"
                                    className="h-7 w-7 inline-grid place-items-center rounded-md text-ink-muted hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {!isLocked && (
                        <div className="px-3 py-2 bg-canvas border-t border-border flex items-center justify-between">
                          <div className="text-caption text-ink-muted">
                            {g.rows.length} location{g.rows.length === 1 ? "" : "s"}
                            {linePicked < lineToPick && (
                              <span className="ml-2 text-warning">
                                · short {lineToPick - linePicked}
                              </span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<Plus size={14} />}
                            onClick={() => addSplit(g.soItemId, head.productId)}
                            disabled={busy}
                          >
                            Add bin
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-border p-3 flex items-center gap-2 justify-end">
              {!isLocked && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<XCircle size={14} />}
                  onClick={cancel}
                  disabled={busy}
                  className="border-danger text-danger hover:bg-danger-soft"
                >
                  Cancel pick list
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={<Printer size={14} />}
                onClick={printPickList}
                disabled={busy}
                title="Open a print-friendly view (Save as PDF from the print dialog)"
              >
                Print / PDF
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              {!isLocked && (
                <>
                  <Button size="sm" variant="outline" onClick={save} disabled={busy}>
                    Save draft
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Wand2 size={14} />}
                    onClick={() => autoPick(false)}
                    disabled={busy}
                    title="Fill every line to the requested qty (capped at available stock) and create the packing slip"
                  >
                    Auto-pick all
                  </Button>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    onClick={complete}
                    disabled={busy || totalPicked === 0}
                  >
                    {busy ? "Working…" : "Complete pick → create packing slip"}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border border-border rounded-md p-3 bg-canvas">
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold mb-1">
      {label}
    </div>
    <div>{children}</div>
  </div>
);
