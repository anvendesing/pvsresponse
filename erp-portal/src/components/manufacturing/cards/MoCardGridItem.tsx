import { Factory, Zap } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import type { ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { moPrimaryLabel, moSecondaryLabel } from "@/lib/mo-display";
import { isMoClosed, moStatusTone } from "@/lib/mo-utils";

interface Props {
  order: ProductionOrder;
  selected?: boolean;
  onClick: () => void;
}

export const MoCardGridItem = ({ order, selected, onClick }: Props) => {
  const pct = order.plannedQty
    ? Math.min(100, Math.round((order.actualQty / order.plannedQty) * 100))
    : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border bg-white p-4 transition-all hover:shadow-md hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/30",
        selected ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-caption font-semibold text-primary">{order.orderNo}</div>
          <div className="text-body-sm font-semibold mt-1 truncate">{moPrimaryLabel(order)}</div>
          <div className="text-caption text-ink-muted truncate">{moSecondaryLabel(order)}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip tone={moStatusTone(order.status)} size="sm">
            {order.status}
          </Chip>
          {(order.urgentQty ?? 0) > 0 && !isMoClosed(order.status) && (
            <Chip size="sm" tone="warning" icon={<Zap size={10} />}>
              {num(order.urgentQty!)} urgent
            </Chip>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-caption text-ink-muted">
        <Factory size={12} className="shrink-0" />
        <span className="truncate">
          {order.line?.name ?? order.facility?.name ?? order.station ?? "—"}
          {order.lineId === null && !isMoClosed(order.status) && (
            <span className="ml-1 text-warning font-semibold">· awaiting line</span>
          )}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-caption">
        <span className="text-ink-muted">Output</span>
        <span className="tnum font-semibold text-ink">
          {num(order.actualQty)} / {num(order.plannedQty)}
        </span>
      </div>

      <div className="mt-1.5 h-1.5 bg-canvas rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            order.status === "delayed"
              ? "bg-danger"
              : order.status === "completed"
                ? "bg-success"
                : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
};
