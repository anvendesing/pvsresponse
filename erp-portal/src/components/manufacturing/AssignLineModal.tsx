// Supervisor action: assign each work order to a production line and machine.

import { useEffect, useMemo, useState } from "react";
import { GitBranch, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { ProductionOrder } from "@/data/types";
import {
  WoLineMachineFields,
  type MachineOption,
  type ProductionLineOption,
} from "./WoLineMachineFields";

interface WorkOrderSummary {
  id: string;
  workOrderNo: string;
  status: string;
  lineId?: string | null;
  machineId?: string | null;
}

interface Props {
  mo: ProductionOrder;
  onClose: () => void;
  onAssigned: () => void;
}

export const AssignLineModal = ({ mo, onClose, onAssigned }: Props) => {
  const facilityId = mo.facilityId ?? "";
  const [assignments, setAssignments] = useState<
    Record<string, { lineId: string; machineId: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesResp = useApi(
    () =>
      facilityId
        ? api.productionLines({ facilityId, active: true })
        : Promise.resolve([]),
    [facilityId]
  );
  const machinesResp = useApi(
    () =>
      facilityId
        ? api.machines({ facilityId, active: true })
        : Promise.resolve([]),
    [facilityId]
  );

  const lines = (linesResp.data as ProductionLineOption[] | null) ?? [];
  const machines = useMemo(() => {
    const raw = (machinesResp.data as Array<{
      id: string;
      code: string;
      name: string;
      productionLineId: string;
    }> | null) ?? [];
    return raw.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      productionLineId: m.productionLineId,
    })) satisfies MachineOption[];
  }, [machinesResp.data]);

  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  useEffect(() => {
    if (!mo.id) return;
    void (api.productionOrder(mo.id) as Promise<{ workOrders?: WorkOrderSummary[] }>)
      .then((detail) => {
        const open = (detail.workOrders ?? []).filter(
          (w) => w.status !== "complete" && w.status !== "running"
        );
        setWorkOrders(open);
        const init: Record<string, { lineId: string; machineId: string }> = {};
        for (const w of open) {
          init[w.id] = {
            lineId: w.lineId ?? mo.lineId ?? "",
            machineId: w.machineId ?? "",
          };
        }
        setAssignments(init);
      })
      .catch(() => {});
  }, [mo.id, mo.lineId]);

  const submit = async () => {
    if (workOrders.length === 0) {
      setError("No open work orders on this MO.");
      return;
    }
    const missing = workOrders.filter((w) => !assignments[w.id]?.lineId);
    if (missing.length) {
      return setError(`Pick a line for ${missing.map((w) => w.workOrderNo).join(", ")}.`);
    }

    setBusy(true);
    setError(null);
    try {
      for (const wo of workOrders) {
        const a = assignments[wo.id]!;
        await api.assignMoWorkOrder(mo.id, wo.id, {
          lineId: a.lineId,
          machineId: a.machineId || null,
        });
      }
      const firstLineId = assignments[workOrders[0]!.id]?.lineId;
      if (firstLineId && !mo.lineId) {
        await api.assignMoToLine(mo.id, { lineId: firstLineId });
      }
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
        className="bg-surface w-[580px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <GitBranch size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Assign lines &amp; machines
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
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm shrink-0">
            {error}
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Facility
            </div>
            <div className="h-10 flex items-center px-3 bg-canvas border border-border rounded-md text-body text-ink-muted">
              {mo.facility?.name ?? mo.facilityId ?? "—"}
            </div>
          </div>

          {workOrders.length === 0 ? (
            <div className="text-body-sm text-ink-muted text-center py-4">
              No open work orders to assign.
            </div>
          ) : (
            <div className="space-y-4">
              {workOrders.map((wo) => (
                <div key={wo.id} className="rounded-md border border-border p-3 bg-canvas/30">
                  <div className="font-mono text-caption text-primary mb-2">
                    {wo.workOrderNo}
                  </div>
                  <WoLineMachineFields
                    compact
                    lines={lines}
                    machines={machines}
                    lineId={assignments[wo.id]?.lineId ?? ""}
                    machineId={assignments[wo.id]?.machineId ?? ""}
                    onLineChange={(lineId) =>
                      setAssignments((prev) => ({
                        ...prev,
                        [wo.id]: { lineId, machineId: "" },
                      }))
                    }
                    onMachineChange={(machineId) =>
                      setAssignments((prev) => ({
                        ...prev,
                        [wo.id]: {
                          lineId: prev[wo.id]?.lineId ?? "",
                          machineId,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || workOrders.length === 0}
            icon={<GitBranch size={14} />}
          >
            {busy ? "Saving…" : "Save assignments"}
          </Button>
        </div>
      </div>
    </div>
  );
};
