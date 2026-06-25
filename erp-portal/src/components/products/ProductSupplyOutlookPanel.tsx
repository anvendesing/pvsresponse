import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Factory, ShoppingCart } from "lucide-react";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import type { ProductSupplyOutlook } from "@/data/types";
import { api } from "@/lib/api";
import { num } from "@/lib/format";

interface Props {
  productId: string;
  uom: string;
}

export const ProductSupplyOutlookPanel = ({ productId, uom }: Props) => {
  const [outlook, setOutlook] = useState<ProductSupplyOutlook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void api
      .productSupplyOutlook(productId)
      .then(setOutlook)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) {
    return (
      <Card title="Supply outlook">
        <p className="text-body-sm text-ink-muted animate-pulse px-3 py-2">Loading…</p>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Supply outlook">
        <p className="text-body-sm text-danger px-3 py-2">{error}</p>
      </Card>
    );
  }
  if (!outlook) return null;

  const hasIncoming = outlook.incomingPo > 0 || outlook.incomingMo > 0;
  const hasSources =
    outlook.purchaseOrders.length > 0 || outlook.manufacturingOrders.length > 0;

  return (
    <Card title="Supply outlook" noPadding>
      <div className="px-3 py-3 space-y-3 border-b border-border bg-canvas/50">
        <div className="grid grid-cols-2 gap-2 text-body-sm">
          <Metric label="On hand" value={`${num(outlook.onHand)} ${uom}`} />
          <Metric
            label="Incoming (PO)"
            value={`+${num(outlook.incomingPo)} ${uom}`}
            tone={outlook.incomingPo > 0 ? "info" : undefined}
          />
          <Metric
            label="Incoming (MO)"
            value={`+${num(outlook.incomingMo)} ${uom}`}
            tone={outlook.incomingMo > 0 ? "info" : undefined}
          />
          <Metric
            label="Committed (SO)"
            value={
              outlook.outgoingSo > 0
                ? `−${num(outlook.outgoingSo)} ${uom}`
                : `0 ${uom}`
            }
            tone={outlook.outgoingSo > 0 ? "warning" : undefined}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip size="sm" tone="primary">
            Outlook {num(outlook.supplyOutlook)} {uom}
          </Chip>
          <span title="On hand − committed + incoming (Odoo-style forecast)">
            <Chip size="sm" tone="neutral">
              Forecasted {num(outlook.forecasted)} {uom}
            </Chip>
          </span>
        </div>
        <p className="text-caption text-ink-muted leading-snug">
          Outlook = on hand + open PO/MO not yet received. Forecasted also subtracts
          confirmed sales demand. Physical stock only moves when a GRN or MO completion
          posts to the inventory ledger.
        </p>
      </div>

      {hasSources ? (
        <div className="divide-y divide-border">
          {outlook.purchaseOrders.length > 0 && (
            <section className="px-3 py-2">
              <div className="text-caption font-semibold uppercase text-ink-muted mb-1.5 flex items-center gap-1">
                <ShoppingCart size={12} />
                Expected from purchase orders
              </div>
              <ul className="space-y-1.5">
                {outlook.purchaseOrders.map((po) => (
                  <li key={po.poId} className="flex items-start justify-between gap-2 text-body-sm">
                    <div className="min-w-0">
                      <Link
                        to={`/procurement?poId=${encodeURIComponent(po.poId)}`}
                        className="font-mono text-caption text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {po.poNo}
                        <ExternalLink size={11} />
                      </Link>
                      <div className="text-caption text-ink-muted truncate">
                        {po.vendorCode} · {num(po.received)}/{num(po.ordered)} received
                      </div>
                      {po.isDraft && (
                        <Chip size="sm" tone="neutral" className="mt-0.5">
                          Draft — not sent to vendor
                        </Chip>
                      )}
                    </div>
                    <span className="tnum font-semibold text-info shrink-0">
                      +{num(po.remaining)} {uom}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {outlook.manufacturingOrders.length > 0 && (
            <section className="px-3 py-2">
              <div className="text-caption font-semibold uppercase text-ink-muted mb-1.5 flex items-center gap-1">
                <Factory size={12} />
                Expected from production
              </div>
              <ul className="space-y-1.5">
                {outlook.manufacturingOrders.map((mo) => (
                  <li key={mo.moId} className="flex items-start justify-between gap-2 text-body-sm">
                    <div className="min-w-0">
                      <Link
                        to={`/manufacturing?moId=${encodeURIComponent(mo.moId)}`}
                        className="font-mono text-caption text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {mo.orderNo}
                        <ExternalLink size={11} />
                      </Link>
                      <div className="text-caption text-ink-muted">
                        {mo.status}
                        {mo.variantSku ? ` · ${mo.variantSku}` : ""} · {num(mo.actualQty)}/
                        {num(mo.plannedQty)} done
                      </div>
                    </div>
                    <span className="tnum font-semibold text-info shrink-0">
                      +{num(mo.remaining)} {uom}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        !hasIncoming && (
          <p className="px-3 py-3 text-body-sm text-ink-muted">
            No open PO or MO supply for this product.
          </p>
        )
      )}
    </Card>
  );
};

const Metric = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "info" | "warning";
}) => (
  <div className="bg-surface border border-border rounded px-2 py-1.5">
    <div className="text-caption text-ink-muted uppercase">{label}</div>
    <div
      className={`tnum font-semibold ${
        tone === "info" ? "text-info" : tone === "warning" ? "text-warning" : "text-ink"
      }`}
    >
      {value}
    </div>
  </div>
);
