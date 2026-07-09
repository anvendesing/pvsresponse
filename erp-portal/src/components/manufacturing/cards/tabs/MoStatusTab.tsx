import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import type { ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { dd, num } from "@/lib/format";
import { moPrimaryLabel, moSecondaryLabel } from "@/lib/mo-display";
import { isMoClosed, moStatusTone } from "@/lib/mo-utils";

const BigStat = ({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "danger" | "warning";
}) => (
  <div className="rounded-lg border border-border bg-canvas px-3 py-2">
    <div className="text-caption text-ink-muted uppercase tracking-wide">{label}</div>
    <div
      className={cn(
        "text-h3 font-bold tnum mt-0.5",
        tone === "primary" && "text-primary",
        tone === "danger" && "text-danger",
        tone === "warning" && "text-warning"
      )}
    >
      {value}
    </div>
  </div>
);

export interface MoStatusTabProps {
  order: ProductionOrder;
  busy: string | null;
  onCancel: () => void;
  onComplete: () => void;
  /** Single-page layout — copy refers to sections below, not tabs. */
  unified?: boolean;
}

export const MoStatusTab = ({
  order,
  busy,
  onCancel,
  onComplete,
  unified = false,
}: MoStatusTabProps) => {
  const closed = isMoClosed(order.status);
  const completion = order.plannedQty
    ? Math.round((order.actualQty / order.plannedQty) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <Card
        title={
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-caption text-ink-muted">{order.orderNo}</span>
            <span>{moPrimaryLabel(order)}</span>
            <Chip tone={moStatusTone(order.status)}>{order.status}</Chip>
          </div>
        }
        subtitle={
          <span>
            {moSecondaryLabel(order)} · {order.facility?.name ?? order.station ?? "—"}
            {order.line ? <span className="text-ink-muted"> › {order.line.name}</span> : null}
            {" · "}Due {dd(order.dueDate)}
          </span>
        }
        accent="primary"
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <BigStat label="Planned" value={num(order.plannedQty)} />
          {(order.urgentQty ?? 0) > 0 && (
            <BigStat
              label="Urgent shortage"
              value={num(order.urgentQty!)}
              tone="warning"
            />
          )}
          <BigStat label="Actual" value={num(order.actualQty)} tone="primary" />
          <BigStat label="Scrap" value={num(order.scrapQty)} tone="danger" />
          <BigStat label="Rework" value={num(order.reworkQty)} tone="warning" />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-caption font-medium">
            <span>Completion</span>
            <span className="tnum text-ink-muted">
              {completion}% · {num(order.actualQty)} / {num(order.plannedQty)}
            </span>
          </div>
          <div className="mt-1.5 h-2.5 bg-canvas rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                order.status === "delayed" ? "bg-danger" : "bg-primary"
              )}
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
      </Card>

      {!closed && (
        <Card title="Close order" subtitle="Post finished goods to inventory or cancel this MO">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<XCircle size={14} />}
              onClick={onCancel}
              disabled={busy === "cancel"}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel MO"}
            </Button>
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={onComplete}
              disabled={busy === "complete" || order.actualQty <= 0}
            >
              {busy === "complete" ? "Closing…" : "Complete MO · post FG"}
            </Button>
          </div>
          {order.actualQty <= 0 && (
            <p className="mt-3 text-body-sm text-ink-muted flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              Log output in the{" "}
              <strong>{unified ? "Output & consumption" : "Consumption & output"}</strong>{" "}
              {unified ? "section" : "tab"} before completing.
            </p>
          )}
        </Card>
      )}

      {closed && (
        <Card title="Closed order" subtitle="This MO is read-only">
          <p className="text-body-sm text-ink-muted">
            Review consumption, materials, and transfers {unified ? "below" : "on the other tabs"}.
          </p>
        </Card>
      )}
    </div>
  );
};
