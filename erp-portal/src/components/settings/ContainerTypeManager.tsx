// Admin CRUD for packing container types. Drives the "Add container"
// picker on the desktop pack screen and the type chips on the mobile
// pack screen. Each type carries a default tare (kg) that contributes
// to the container's estimated weight rollup. Codes are uppercase
// alphanumeric so labels look good (BOX-S, SACK-50, CARTON, ...).

import { useEffect, useMemo, useState } from "react";
import { Box, Briefcase, Layers, Loader2, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  apiEnabled,
  type ContainerKind,
  type ContainerTypeRow,
} from "@/lib/api";

interface FormState {
  code: string;
  name: string;
  kind: ContainerKind;
  tareKg: number;
  maxKg: number | null;
  active: boolean;
  sortOrder: number;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  kind: "box",
  tareKg: 0,
  maxKg: null,
  active: true,
  sortOrder: 100,
};

const KIND_LABELS: Record<ContainerKind, string> = {
  box: "Box",
  bag: "Bag",
  carton: "Carton",
  sack: "Sack",
  other: "Other",
};

const kindIcon = (k: ContainerKind) => {
  switch (k) {
    case "bag":
      return Briefcase;
    case "carton":
    case "box":
      return Box;
    case "sack":
      return Package;
    default:
      return Layers;
  }
};

export const ContainerTypeManager = () => {
  const [rows, setRows] = useState<ContainerTypeRow[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContainerTypeRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const list = await api.containerTypes();
      setRows(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const open = (row?: ContainerTypeRow) => {
    setError(null);
    setEditing(row ?? null);
    setForm(
      row
        ? {
            code: row.code,
            name: row.name,
            kind: row.kind,
            tareKg: row.tareKg,
            maxKg: row.maxKg ?? null,
            active: row.active,
            sortOrder: row.sortOrder,
          }
        : EMPTY
    );
    setModalOpen(true);
  };

  const close = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        kind: form.kind,
        tareKg: Number(form.tareKg) || 0,
        maxKg: form.maxKg == null || form.maxKg <= 0 ? null : Number(form.maxKg),
        active: form.active,
        sortOrder: Number(form.sortOrder) || 100,
      };
      if (editing) {
        await api.updateContainerType(editing.id, body);
        setBanner(`Container type "${body.name}" updated.`);
      } else {
        await api.createContainerType(body);
        setBanner(`Container type "${body.name}" added.`);
      }
      await load();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: ContainerTypeRow) => {
    if (!confirm(`Delete container type "${row.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteContainerType(row.id);
      setBanner(`Deleted ${row.name}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const order: ContainerKind[] = ["box", "carton", "bag", "sack", "other"];
    const map = new Map<ContainerKind, ContainerTypeRow[]>();
    for (const k of order) map.set(k, []);
    for (const r of rows) (map.get(r.kind) ?? map.get("other")!).push(r);
    return order.map((k) => ({ kind: k, items: map.get(k) ?? [] }));
  }, [rows]);

  return (
    <Card
      title="Container types"
      subtitle="Box / bag / carton / sack catalogue used during packing. Tare adds to estimated weight."
      actions={
        <Button size="sm" icon={<Plus size={14} />} onClick={() => open()}>
          Add type
        </Button>
      }
    >
      {banner && (
        <div className="bg-success-soft border border-success text-success rounded-md px-3 py-2 text-body-sm mb-3 flex items-center justify-between">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="bg-danger-soft border border-danger text-danger rounded-md px-3 py-2 text-body-sm mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-body-sm py-6">
          <Loader2 size={16} className="animate-spin" /> Loading container types…
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ kind, items }) =>
            items.length === 0 ? null : (
              <div key={kind}>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                  {KIND_LABELS[kind]}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map((r) => {
                    const Icon = kindIcon(r.kind);
                    return (
                      <div
                        key={r.id}
                        className="border border-border rounded-md p-3 flex items-center gap-2 bg-canvas"
                      >
                        <Icon size={18} className="text-ink-muted shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate flex items-center gap-2">
                            {r.name}
                            {!r.active && (
                              <Chip size="sm" tone="neutral">
                                inactive
                              </Chip>
                            )}
                          </div>
                          <div className="text-caption text-ink-muted">
                            <span className="font-mono">{r.code}</span> · tare{" "}
                            {r.tareKg.toFixed(2)} kg
                            {r.maxKg ? ` · max ${r.maxKg.toFixed(2)} kg` : ""}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil size={14} />}
                          onClick={() => open(r)}
                          disabled={busy}
                        >
                          {""}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          onClick={() => remove(r)}
                          disabled={busy}
                          className="text-danger hover:bg-danger-soft"
                        >
                          {""}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
          onClick={close}
        >
          <div
            className="bg-surface w-full max-w-lg rounded-md elevation-3 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-h3 font-bold">
                {editing ? "Edit container type" : "New container type"}
              </div>
              <button
                onClick={close}
                className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code"
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="BOX-S"
                />
                <div>
                  <label className="text-caption text-ink-muted block mb-1">Kind</label>
                  <select
                    className="h-10 w-full text-body-sm border border-border rounded-md px-2 bg-white"
                    value={form.kind}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, kind: e.target.value as ContainerKind }))
                    }
                  >
                    {(Object.keys(KIND_LABELS) as ContainerKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Input
                label="Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Small Box (5 kg)"
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="Tare weight (kg)"
                  type="number"
                  step="0.01"
                  value={String(form.tareKg)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tareKg: Number(e.target.value) || 0 }))
                  }
                />
                <Input
                  label="Max load (kg)"
                  type="number"
                  step="0.1"
                  value={form.maxKg == null ? "" : String(form.maxKg)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      maxKg: e.target.value.trim() === "" ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="optional"
                />
                <Input
                  label="Sort order"
                  type="number"
                  value={String(form.sortOrder)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, active: e.target.checked }))
                  }
                />
                Active (show in packing pickers)
              </label>
            </div>
            <div className="mt-4 flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={busy || !form.code.trim() || !form.name.trim()}
              >
                {busy ? "…" : editing ? "Save changes" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
