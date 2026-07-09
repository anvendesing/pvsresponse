// Modal to record a customer payment against open invoices.
// Supports FIFO auto-allocation (default) or manual per-invoice amounts.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useState } from "react";
import { DollarSign, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api, type CustomerRow, type OpenInvoice, type PaymentMode } from "@/lib/api";
import { inr } from "@/lib/format";

interface Props {
  customer: CustomerRow;
  onClose: () => void;
  onSaved: () => void;
}

const MODES: { id: PaymentMode; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "bank_transfer", label: "Bank Transfer" },
  { id: "cheque", label: "Cheque" },
  { id: "credit_note", label: "Credit Note" },
];

export const RecordPaymentModal = ({ customer, onClose, onSaved }: Props) => {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("upi");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().substring(0, 10)
  );
  const [allocationMode, setAllocationMode] = useState<"auto" | "manual">("auto");
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingInvoices(true);
    api
      .customerOpenInvoices(customer.id)
      .then((invs) => {
        setOpenInvoices(invs);
      })
      .finally(() => setLoadingInvoices(false));
  }, [customer.id]);

  const totalAmount = parseFloat(amount) || 0;

  // Recompute manual allocation total
  const manualTotal = Object.values(manualAmounts).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0
  );

  const manualMismatch =
    allocationMode === "manual" &&
    totalAmount > 0 &&
    Math.abs(manualTotal - totalAmount) > 0.005;

  const handleManualChange = (invoiceId: string, val: string) => {
    setManualAmounts((prev) => ({ ...prev, [invoiceId]: val }));
  };

  // Auto-fill manual amounts when user switches to manual or amount changes
  const prefillManual = () => {
    let remaining = totalAmount;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, inv.openAmount);
      if (apply > 0) next[inv.id] = apply.toFixed(2);
      remaining -= apply;
    }
    setManualAmounts(next);
  };

  const handleSave = async () => {
    setError(null);
    if (totalAmount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }

    let allocations: { invoiceId: string; amount: number }[] | undefined;
    if (allocationMode === "manual") {
      allocations = Object.entries(manualAmounts)
        .map(([invoiceId, val]) => ({ invoiceId, amount: parseFloat(val) || 0 }))
        .filter((a) => a.amount > 0);
      const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);
      if (Math.abs(allocTotal - totalAmount) > 0.005) {
        setError(
          `Allocated ${inr(allocTotal)} but payment is ${inr(totalAmount)}. Adjust amounts to match.`
        );
        return;
      }
    }

    try {
      setSaving(true);
      await api.recordPayment({
        customerId: customer.id,
        amount: totalAmount,
        mode,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        paymentDate,
        allocations: allocationMode === "manual" ? allocations : undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      {...backdropDismissProps(onClose)}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <DollarSign size={18} className="text-primary" />
          <div>
            <p className="font-semibold text-ink">Record Payment</p>
            <p className="text-caption text-ink-muted">
              {customer.code} · {customer.name}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-ink-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Amount + date row */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Amount (₹)"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <Input
              label="Payment date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          {/* Mode */}
          <div>
            <label className="block text-caption font-semibold text-ink-muted mb-1">
              Payment mode
            </label>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`px-3 py-1.5 rounded-lg border text-body-sm font-medium transition-colors ${
                    mode === m.id
                      ? "bg-primary text-white border-primary"
                      : "border-border text-ink hover:bg-canvas"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reference */}
          <Input
            label={
              mode === "cheque"
                ? "Cheque number"
                : mode === "bank_transfer"
                ? "UTR / reference"
                : mode === "upi"
                ? "UPI transaction ID"
                : "Reference (optional)"
            }
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="optional"
          />

          {/* Notes */}
          <div>
            <label className="block text-caption font-semibold text-ink-muted mb-1">
              Notes (optional)
            </label>
            <textarea
              className="w-full rounded-lg border border-border px-3 py-2 text-body-sm resize-none"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note"
            />
          </div>

          {/* Allocation mode toggle */}
          <div className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-body-sm font-semibold text-ink">
                Invoice allocation
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllocationMode("auto")}
                  className={`px-2 py-0.5 rounded text-caption font-medium ${
                    allocationMode === "auto"
                      ? "bg-primary text-white"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Auto (FIFO)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAllocationMode("manual");
                    if (totalAmount > 0) prefillManual();
                  }}
                  className={`px-2 py-0.5 rounded text-caption font-medium ${
                    allocationMode === "manual"
                      ? "bg-primary text-white"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>

            {loadingInvoices ? (
              <p className="text-caption text-ink-muted">Loading invoices…</p>
            ) : openInvoices.length === 0 ? (
              <p className="text-caption text-ink-muted">
                No open invoices. Payment will be recorded as an unallocated credit.
              </p>
            ) : (
              <div className="space-y-1.5">
                {openInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 text-body-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-caption font-semibold text-primary">
                        {inv.invoiceNo}
                      </span>
                      {inv.soNo && (
                        <span className="text-ink-muted ml-1">({inv.soNo})</span>
                      )}
                      <span className="ml-2 text-ink-muted">
                        Open: {inr(inv.openAmount)}
                      </span>
                    </div>
                    {allocationMode === "manual" ? (
                      <input
                        type="number"
                        min="0"
                        max={inv.openAmount}
                        step="0.01"
                        value={manualAmounts[inv.id] ?? ""}
                        onChange={(e) =>
                          handleManualChange(inv.id, e.target.value)
                        }
                        className="w-24 rounded border border-border px-2 py-0.5 text-caption text-right"
                        placeholder="0.00"
                      />
                    ) : (
                      <span className="text-ink-muted text-caption">
                        auto
                      </span>
                    )}
                  </div>
                ))}
                {allocationMode === "manual" && (
                  <div className="flex justify-between pt-1 border-t border-border text-caption font-semibold">
                    <span>Total allocated</span>
                    <span className={manualMismatch ? "text-error" : "text-success"}>
                      {inr(manualTotal)}
                      {totalAmount > 0 && ` / ${inr(totalAmount)}`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary: open balance + credit after */}
          {totalAmount > 0 && (
            <div className="rounded-lg bg-canvas px-4 py-3 text-body-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-ink-muted">Current open balance</span>
                <span className="font-semibold">{inr(customer.openBalance ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">After this payment</span>
                <span className="font-semibold text-success">
                  {inr(Math.max(0, (customer.openBalance ?? 0) - totalAmount))}
                </span>
              </div>
              {customer.creditLimit && customer.creditLimit > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">Available credit after</span>
                  <span className="font-semibold text-primary">
                    {inr(
                      Math.min(
                        customer.creditLimit,
                        customer.creditLimit -
                          Math.max(0, (customer.openBalance ?? 0) - totalAmount)
                      )
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-error text-body-sm px-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={saving || totalAmount <= 0 || manualMismatch}
          >
            Record ₹{totalAmount > 0 ? totalAmount.toLocaleString("en-IN") : "—"}
          </Button>
        </div>
      </div>
    </div>
  );
};
