// GRN detail / QC approval modal.
//
// Opens against a GRN row from the procurement list and shows
// everything that came in: vendor, PO, truck/driver, line items
// (received vs rejected), notes. Pending GRNs get explicit
// Approve / Mark rework / Reject buttons; once a decision has
// been recorded the buttons collapse into a status badge with an
// optional "Change decision" action.
//
// Inventory was already posted when the GRN was recorded (unless
// it was created with qcStatus="reject"). Flipping a previously
// passed GRN to "reject" therefore can't unpost stock - we surface
// that caveat in the UI so operators know to reach for the stock
// adjustment screen.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Pencil,
  PackageCheck,
  RotateCcw,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api } from "@/lib/api";
import { dd, num } from "@/lib/format";
import { cn } from "@/lib/cn";

type QcStatus = "pending" | "pass" | "rework" | "reject";

const tone = (s: QcStatus) =>
  s === "pass"
    ? "success"
    : s === "rework"
      ? "warning"
      : s === "reject"
        ? "danger"
        : "info";

interface GrnPayload {
  id: string;
  grnNo: string;
  date: string;
  qcStatus: QcStatus;
  truckNo: string | null;
  driver: string | null;
  notes: string | null;
  receivedBy: string | null;
  po: {
    id: string;
    poNo: string;
    vendor: { id: string; name: string; code: string };
  };
  items: Array<{
    id: string;
    receivedQty: number;
    rejectedQty: number;
    remarks: string | null;
    poItem: {
      productId: string;
      product: { id: string; sku: string; name: string; uom: string };
    };
  }>;
}

interface Props {
  grn: GrnPayload;
  onClose: () => void;
  onUpdated: (msg: string) => void;
}

export const GrnDetailModal = ({ grn, onClose, onUpdated }: Props) => {
  const [busy, setBusy] = useState<QcStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalReceived = grn.items.reduce((s, i) => s + i.receivedQty, 0);
  const totalRejected = grn.items.reduce((s, i) => s + i.rejectedQty, 0);
  const totalAccepted = totalReceived - totalRejected;
  const isPending = grn.qcStatus === "pending";

  const decide = async (next: QcStatus) => {
    // Confirm late rejections - inventory has likely been posted.
    if (next === "reject" && grn.qcStatus !== "pending") {
      const ok = window.confirm(
        `${grn.grnNo} was already in "${grn.qcStatus}". Stock was posted at receipt; ` +
          "marking it rejected here only flags the QC outcome and won't unpost inventory. " +
          "Continue?"
      );
      if (!ok) return;
    }
    setBusy(next);
    setError(null);
    try {
      await api.updateGrnQc(grn.id, { qcStatus: next });
      const verb =
        next === "pass"
          ? "approved"
          : next === "reject"
            ? "rejected"
            : next === "rework"
              ? "marked for rework"
              : "set to pending";
      onUpdated(`${grn.grnNo} ${verb}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[920px] max-w-[95vw] max-h-[92vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 grid place-items-center bg-primary-50 text-primary rounded-md">
              <ClipboardList size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-h3 font-bold">{grn.grnNo}</span>
                <Chip size="sm" tone={tone(grn.qcStatus)} className="capitalize">
                  {grn.qcStatus}
                </Chip>
              </div>
              <div className="text-caption text-ink-muted">
                {grn.po.poNo} · {grn.po.vendor.name} · received {dd(grn.date)}
                {grn.receivedBy ? ` by ${grn.receivedBy}` : ""}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="underline text-caption"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Vendor / shipping strip */}
        <div className="px-5 py-3 grid grid-cols-12 gap-3 border-b border-border bg-canvas">
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-0.5">
              Vendor
            </div>
            <div className="text-body-sm font-semibold">{grn.po.vendor.name}</div>
            <div className="text-caption text-ink-muted font-mono">
              {grn.po.vendor.code}
            </div>
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-0.5">
              Truck
            </div>
            <div className="text-body-sm flex items-center gap-1.5">
              <Truck size={12} className="text-ink-muted" />
              {grn.truckNo || <span className="text-ink-muted">—</span>}
            </div>
            {grn.driver && (
              <div className="text-caption text-ink-muted">
                Driver: {grn.driver}
              </div>
            )}
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-0.5">
              Lines
            </div>
            <div className="text-body-sm tnum">
              {grn.items.length} · {num(totalReceived, 3)} received
            </div>
            {totalRejected > 0 && (
              <div className="text-caption text-danger tnum">
                {num(totalRejected, 3)} rejected
              </div>
            )}
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-0.5">
              Net accepted
            </div>
            <div className="text-h3 font-bold text-primary tnum">
              {num(totalAccepted, 3)}
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-12 grid-header-cell text-caption sticky top-0 bg-surface z-10 border-b border-border">
            <div className="col-span-2 px-3 py-2">SKU</div>
            <div className="col-span-4 px-3 py-2">Product</div>
            <div className="col-span-2 px-3 py-2 text-right">Received</div>
            <div className="col-span-1 px-3 py-2 text-right">Rejected</div>
            <div className="col-span-1 px-3 py-2 text-right">Net</div>
            <div className="col-span-2 px-3 py-2">Remarks</div>
          </div>
          {grn.items.map((it) => {
            const net = it.receivedQty - it.rejectedQty;
            return (
              <div
                key={it.id}
                className="grid grid-cols-12 items-center border-b border-border hover:bg-canvas/40"
              >
                <div className="col-span-2 px-3 py-2 font-mono text-caption font-semibold">
                  {it.poItem.product.sku}
                </div>
                <div className="col-span-4 px-3 py-2 truncate">
                  {it.poItem.product.name}
                </div>
                <div className="col-span-2 px-3 py-2 text-right tnum">
                  {num(it.receivedQty, 3)}{" "}
                  <span className="text-caption text-ink-muted">
                    {it.poItem.product.uom}
                  </span>
                </div>
                <div className="col-span-1 px-3 py-2 text-right tnum text-danger">
                  {it.rejectedQty > 0 ? num(it.rejectedQty, 3) : "—"}
                </div>
                <div className="col-span-1 px-3 py-2 text-right tnum font-semibold">
                  {num(net, 3)}
                </div>
                <div className="col-span-2 px-3 py-2 text-caption text-ink-muted truncate">
                  {it.remarks || "—"}
                </div>
              </div>
            );
          })}
        </div>

        {grn.notes && (
          <div className="px-5 py-3 border-t border-border bg-canvas">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Receipt notes
            </div>
            <div className="text-body-sm whitespace-pre-line">{grn.notes}</div>
          </div>
        )}

        {/* Footer / actions */}
        <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-2 bg-canvas">
          <div className="text-caption text-ink-muted">
            {isPending
              ? "Inspect the goods, then record the QC decision."
              : `QC already decided: ${grn.qcStatus}.`}
          </div>
          <div className="flex gap-2">
            {(isPending || editMode) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => decide("rework")}
                  disabled={busy !== null}
                  className={cn(
                    "!border-warning !text-warning hover:!bg-warning-soft"
                  )}
                >
                  {busy === "rework" ? "Saving…" : "Rework"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<XCircle size={14} />}
                  onClick={() => decide("reject")}
                  disabled={busy !== null}
                  className={cn(
                    "!border-danger !text-danger hover:!bg-danger-soft"
                  )}
                >
                  {busy === "reject" ? "Saving…" : "Reject"}
                </Button>
                <Button
                  size="sm"
                  icon={<CheckCircle2 size={14} />}
                  onClick={() => decide("pass")}
                  disabled={busy !== null}
                >
                  {busy === "pass" ? "Saving…" : "Approve"}
                </Button>
              </>
            )}
            {!isPending && !editMode && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Pencil size={14} />}
                onClick={() => setEditMode(true)}
              >
                Change decision
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<PackageCheck size={14} />}
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
