import { inr, inrPaise } from "@/lib/format";
import type { BillingTotals } from "@/lib/billingTotals";
import { cn } from "@/lib/cn";

type Props = {
  totals: BillingTotals;
  /** One-line caption for KPI cards */
  variant?: "stack" | "inline";
  goodsSubLabel?: string;
  totalLabel?: string;
  className?: string;
};

const TaxRows = ({ totals }: { totals: BillingTotals }) => {
  if (totals.taxKind === "inter") {
    return (
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">IGST (goods)</span>
        <span className="tnum">{inrPaise(totals.igst)}</span>
      </div>
    );
  }
  return (
    <>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">CGST (goods)</span>
        <span className="tnum">{inrPaise(totals.cgst)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">SGST (goods)</span>
        <span className="tnum">{inrPaise(totals.sgst)}</span>
      </div>
    </>
  );
};

const FreightTaxRows = ({ totals }: { totals: BillingTotals }) => {
  if (totals.transportTax <= 0) return null;
  if (totals.taxKind === "inter") {
    return (
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">IGST on freight (18%)</span>
        <span className="tnum">{inrPaise(totals.transportIgst)}</span>
      </div>
    );
  }
  return (
    <>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">CGST on freight (9%)</span>
        <span className="tnum">{inrPaise(totals.transportCgst)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">SGST on freight (9%)</span>
        <span className="tnum">{inrPaise(totals.transportSgst)}</span>
      </div>
    </>
  );
};

export const BillingTotalsBreakdown = ({
  totals,
  variant = "stack",
  goodsSubLabel = "Sub-total (goods, excl. GST)",
  totalLabel = "Total",
  className,
}: Props) => {
  const hasFreight = totals.transportCharge > 0 || totals.transportTax > 0;

  if (variant === "inline") {
    const taxLabel =
      totals.taxKind === "inter"
        ? `IGST ${inrPaise(totals.igst)}`
        : `CGST ${inrPaise(totals.cgst)} · SGST ${inrPaise(totals.sgst)}`;
    return (
      <div className={cn("text-caption text-ink-muted", className)}>
        Sub {inrPaise(totals.goodsSubTotal)} · {taxLabel}
        {hasFreight && (
          <>
            {" "}
            · Freight {inr(totals.transportCharge)}
            {totals.transportTax > 0 && <> · Freight GST {inrPaise(totals.transportTax)}</>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 text-body-sm", className)}>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">{goodsSubLabel}</span>
        <span className="tnum">{inrPaise(totals.goodsSubTotal)}</span>
      </div>
      <TaxRows totals={totals} />
      {hasFreight && (
        <>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Freight / transport</span>
            <span className="tnum">{inr(totals.transportCharge)}</span>
          </div>
          <FreightTaxRows totals={totals} />
        </>
      )}
      {Math.abs(totals.roundOff) >= 0.001 && (
        <div className="flex justify-between gap-4">
          <span className="text-ink-muted">Round off</span>
          <span className="tnum">{inrPaise(totals.roundOff)}</span>
        </div>
      )}
      <div className="flex justify-between gap-4 pt-1 border-t border-border font-bold">
        <span>{totalLabel}</span>
        <span className="tnum text-primary">{inr(totals.grandTotal)}</span>
      </div>
    </div>
  );
};
