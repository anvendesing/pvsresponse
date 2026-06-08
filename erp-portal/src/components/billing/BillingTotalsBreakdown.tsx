import { inr } from "@/lib/format";
import type { BillingTotals } from "@/lib/billingTotals";
import { cn } from "@/lib/cn";

type Props = {
  totals: BillingTotals;
  /** One-line caption for KPI cards */
  variant?: "stack" | "inline";
  goodsSubLabel?: string;
  goodsTaxLabel?: string;
  totalLabel?: string;
  className?: string;
};

export const BillingTotalsBreakdown = ({
  totals,
  variant = "stack",
  goodsSubLabel = "Sub-total (goods)",
  goodsTaxLabel = "GST (goods)",
  totalLabel = "Total",
  className,
}: Props) => {
  const hasFreight = totals.transportCharge > 0 || totals.transportTax > 0;

  if (variant === "inline") {
    return (
      <div className={cn("text-caption text-ink-muted", className)}>
        Sub {inr(totals.goodsSubTotal)} · Tax {inr(totals.goodsTax)}
        {hasFreight && (
          <>
            {" "}
            · Freight {inr(totals.transportCharge)}
            {totals.transportTax > 0 && <> · GST (freight) {inr(totals.transportTax)}</>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 text-body-sm", className)}>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">{goodsSubLabel}</span>
        <span className="tnum">{inr(totals.goodsSubTotal)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-muted">{goodsTaxLabel}</span>
        <span className="tnum">{inr(totals.goodsTax)}</span>
      </div>
      {hasFreight && (
        <>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Freight / transport</span>
            <span className="tnum">{inr(totals.transportCharge)}</span>
          </div>
          {totals.transportTax > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-ink-muted">GST on freight (18%)</span>
              <span className="tnum">{inr(totals.transportTax)}</span>
            </div>
          )}
        </>
      )}
      <div className="flex justify-between gap-4 pt-1 border-t border-border font-bold">
        <span>{totalLabel}</span>
        <span className="tnum text-primary">{inr(totals.grandTotal)}</span>
      </div>
    </div>
  );
};
