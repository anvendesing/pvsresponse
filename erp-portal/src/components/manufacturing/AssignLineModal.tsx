// Supervisor action: assign a manufacturing order to a production line.
// Optionally also assigns individual work orders to machines within that line.

import { useEffect, useState } from "react";
import { GitBranch, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { ProductionOrder } from "@/data/types";

interface WorkOrderSummary {
  id: string;
  workOrderNo: string;
  status: string;
}

interface Props {
  mo: ProductionOrder;
  onClose: () => void;
  onAssigned: () => void;
}

export const AssignLineModal = ({ mo, onClose, onAssigned }: Props) => {
  const facilityId = mo.facilityId ?? "";
  const [selectedLineId, setSelectedLineId] = useState<string>(mo.lineId ?? "");
  const [workOrderAssignments, setWorkOrderAssignments] = useState<
    Record<string, string>
  >({}); // workOrderId -> machineId
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesResp = useApi(
    () => api.productionLines({ facilityId: facilityId || undefined, active: true }),
    [facilityId]
  );
  const machinesResp = useApi(
    () =>
      selectedLineId
        ? api.machines({ productionLineId: selectedLineId, active: true })
        : Promise.resolve([]),
    [selectedLineId]
  );

  const lines =
    (linesResp.data as Array<{
      id: string;
      code: string;
      name: string;
    }> | null) ?? [];

  const machines =
    (machinesResp.data as Array<{
      id: string;
      code: string;
      name: string;
    }> | null) ?? [];

  // Fetch open work orders for this MO via the MO detail endpoint
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  useEffect(() => {
    if (!mo.id) return;
    void (api.productionOrder(mo.id) as Promise<{
      workOrders?: WorkOrderSummary[];
    }>)
      .then((detail) => {
        const open = (detail.workOrders ?? []).filter(
          (w) => w.status !== "completed"
        );
        setWorkOrders(open);
      })
      .catch(() => {});
  }, [mo.id]);

  const submit = async () => {
    if (!selectedLineId) return setError("Pick a production line.");
    setBusy(true);
    setError(null);
    try {
      await api.assignMoToLine(mo.id, {
        lineId: selectedLineId,
        workOrderAssignments: Object.entries(workOrderAssignments)
          .filter(([, machineId]) => machineId)
          .map(([workOrderId, machineId]) => ({ workOrderId, machineId })),
      });
      onAssigned();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[540px] max-w-[95vw] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <GitBranch size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Assign to production line
              </div>
              <div className="text-body-sm font-medium">{mo.orderNo}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">
            {error}
          </div>
        )}

        <div className="p-5 space-y-4">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Facility
            </div>
            <div className="h-10 flex items-center px-3 bg-canvas border border-border rounded-md text-body text-ink-muted">
              {mo.facility?.name ?? mo.facilityId ?? "—"}
            </div>
          </div>

          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Production line
            </div>
            <select
              value={selectedLineId}
              onChange={(e) => {
                setSelectedLineId(e.target.value);
                setWorkOrderAssignments({});
              }}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
            >
              <option value="">— Select a line —</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </div>

          {workOrders.length > 0 && selectedLineId && (
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                Machine assignment (optional)
              </div>
              <div className="space-y-2">
                {workOrders.map((wo) => (
                  <div key={wo.id} className="flex items-center gap-3">
                    <span className="text-body-sm font-mono text-primary w-28 shrink-0">
                      {wo.workOrderNo}
                    </span>
                    <select
                      value={workOrderAssignments[wo.id] ?? ""}
                      onChange={(e) =>
                        setWorkOrderAssignments({
                          ...workOrderAssignments,
                          [wo.id]: e.target.value,
                        })
                      }
                      className="h-8 flex-1 bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary"
                    >
                      <option value="">— Any machine —</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} · {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !selectedLineId}
            icon={<GitBranch size={14} />}
          >
            {busy ? "Assigning…" : "Assign line"}
          </Button>
        </div>
      </div>
    </div>
  );
};
