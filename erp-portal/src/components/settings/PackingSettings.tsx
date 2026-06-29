// Pack workflow toggles: multi-container mode + seal confirmation.
// Persist on CompanyProfile so the values stay singleton across the
// deployment. Surfaces a description of what each switch changes so
// admins can decide without reading the docs.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { api } from "@/lib/api";

export const PackingSettings = () => {
  const [loading, setLoading] = useState(true);
  const [multi, setMulti] = useState(true);
  const [seal, setSeal] = useState(true);
  const [binSort, setBinSort] = useState(true);
  const [pristine, setPristine] = useState({ multi: true, seal: true, binSort: true });
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await api.getCompanyProfile();
        if (!alive) return;
        const m = p.packMultiContainerEnabled !== false;
        const s = p.packRequireSealConfirmation !== false;
        const b = p.pickSortByBinEnabled !== false;
        setMulti(m);
        setSeal(s);
        setBinSort(b);
        setPristine({ multi: m, seal: s, binSort: b });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dirty =
    multi !== pristine.multi ||
    seal !== pristine.seal ||
    binSort !== pristine.binSort;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateCompanyProfile({
        packMultiContainerEnabled: multi,
        packRequireSealConfirmation: seal,
        pickSortByBinEnabled: binSort,
      });
      setPristine({ multi, seal, binSort });
      setBanner("Packing settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card title="Packing">
        <div className="flex items-center gap-2 text-ink-muted text-body-sm py-6">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Packing"
      subtitle="Picking walk-path order and multi-container pack workflow for desktop and mobile."
      actions={
        dirty ? (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        ) : undefined
      }
    >
      {banner && (
        <div className="bg-success-soft border border-success text-success rounded-md px-3 py-2 text-body-sm mb-3">
          {banner}
        </div>
      )}
      {error && (
        <div className="bg-danger-soft border border-danger text-danger rounded-md px-3 py-2 text-body-sm mb-3">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <ToggleRow
          label="Sort pick lists by bin location"
          description="When on, mobile and print pick lists order lines by warehouse walk path (zone → shelf → bin). Turn off to keep sales-order line order — useful while variants are not yet mapped to bins."
          checked={binSort}
          onChange={setBinSort}
        />
        <ToggleRow
          label="Multi-container packing"
          description="Packers split orders across boxes / bags / sacks. The slip can't be packed until every unit is allocated into a sealed container. Trip weight rolls up from container weights."
          checked={multi}
          onChange={setMulti}
        />
        <ToggleRow
          label="Confirm before sealing"
          description="Show a summary modal (items, est weight) before locking a container. Recommended for less experienced packers."
          checked={seal}
          onChange={setSeal}
          disabled={!multi}
        />
      </div>
    </Card>
  );
};

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

const ToggleRow = ({ label, description, checked, disabled, onChange }: ToggleRowProps) => (
  <label
    className={`flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-canvas ${
      disabled ? "opacity-60" : "cursor-pointer hover:border-primary"
    }`}
  >
    <div className="flex-1 min-w-0">
      <div className="font-semibold text-body-sm">{label}</div>
      <div className="text-caption text-ink-muted mt-0.5">{description}</div>
    </div>
    <input
      type="checkbox"
      className="mt-1"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);
