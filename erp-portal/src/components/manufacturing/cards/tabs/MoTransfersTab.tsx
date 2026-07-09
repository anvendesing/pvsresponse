import { ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import type { TransferOrderRow } from "@/lib/api";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

interface Props {
  transfers: TransferOrderRow[] | null;
  loading: boolean;
}

export const MoTransfersTab = ({ transfers, loading }: Props) => (
  <Card
    title="Transfer orders"
    subtitle="Replenishment and putaway moves linked to this manufacturing order"
    noPadding
  >
    {loading && !transfers ? (
      <div className="px-4 py-8 text-center text-body-sm text-ink-muted">Loading transfer orders…</div>
    ) : !transfers || transfers.length === 0 ? (
      <div className="px-4 py-8 text-center text-body-sm text-ink-muted">
        No transfer orders linked yet. Use <strong>Release</strong> on the Status tab to create
        replenishment moves when stock is short at the line.
      </div>
    ) : (
      <div className="divide-y divide-border">
        {transfers.map((to) => {
          const kindColor =
            to.kind === "putaway"
              ? "bg-purple-50 text-purple-700 border-purple-200"
              : to.kind === "replenishment"
                ? "bg-orange-50 text-orange-700 border-orange-200"
                : "bg-canvas text-ink-muted border-border";
          const statusColor =
            to.status === "done"
              ? "success"
              : to.status === "in_transit"
                ? "primary"
                : to.status === "cancelled"
                  ? "danger"
                  : "neutral";

          return (
            <div key={to.id} className="px-4 py-3 flex items-center gap-3">
              <ArrowRightLeft size={14} className="text-ink-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-caption text-primary font-semibold">{to.transferNo}</span>
                  <span
                    className={cn(
                      "text-[10px] rounded-full px-2 py-0.5 border font-semibold uppercase tracking-wide",
                      kindColor
                    )}
                  >
                    {to.kind}
                  </span>
                  <Chip size="sm" tone={statusColor as "neutral"}>
                    {to.status.replace("_", " ")}
                  </Chip>
                </div>
                <div className="text-caption text-ink-muted mt-0.5">
                  {to.fromWarehouse.code} → {to.toWarehouse.code} · {to.items.length} item(s)
                </div>
                {to.items.slice(0, 3).map((i, idx) => (
                  <div key={idx} className="text-caption text-ink-muted mt-0.5 pl-2 border-l-2 border-border">
                    {i.variant?.sku ?? i.product.sku}: {num(i.qtyRequested)} req
                  </div>
                ))}
              </div>
              {to.status !== "done" && to.status !== "cancelled" && (
                <a
                  href={`/m/transfers/${to.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-primary hover:underline shrink-0"
                >
                  Open mobile ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    )}
  </Card>
);
