import { useMemo } from "react";

export type ProductionLineOption = { id: string; code: string; name: string };
export type MachineOption = {
  id: string;
  code: string;
  name: string;
  productionLineId: string;
};

interface Props {
  lines: ProductionLineOption[];
  machines: MachineOption[];
  lineId: string;
  machineId: string;
  disabled?: boolean;
  compact?: boolean;
  onLineChange: (lineId: string) => void;
  onMachineChange: (machineId: string) => void;
}

export const WoLineMachineFields = ({
  lines,
  machines,
  lineId,
  machineId,
  disabled,
  compact,
  onLineChange,
  onMachineChange,
}: Props) => {
  const lineMachines = useMemo(
    () => (lineId ? machines.filter((m) => m.productionLineId === lineId) : []),
    [machines, lineId]
  );

  const selectClass = compact
    ? "h-8 w-full bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary disabled:opacity-60"
    : "h-9 w-full bg-white border border-border rounded-md px-2 text-body-sm outline-none focus:border-primary disabled:opacity-60";

  return (
    <div className={compact ? "grid grid-cols-2 gap-2 w-full max-w-md" : "grid sm:grid-cols-2 gap-2 mt-2"}>
      <div>
        <label className="text-caption text-ink-muted block mb-0.5">Production line</label>
        <select
          value={lineId}
          disabled={disabled}
          onChange={(e) => onLineChange(e.target.value)}
          className={selectClass}
        >
          <option value="">— Select line —</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {l.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-caption text-ink-muted block mb-0.5">Machine</label>
        <select
          value={machineId}
          disabled={disabled || !lineId}
          onChange={(e) => onMachineChange(e.target.value)}
          className={selectClass}
        >
          <option value="">— Select machine —</option>
          {lineMachines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} · {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
