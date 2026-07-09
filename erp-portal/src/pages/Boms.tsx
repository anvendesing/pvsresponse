// Dedicated BOM management — list and editor as full workspace pages
// instead of overlays on Manufacturing.

import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BomEditor } from "@/components/manufacturing/BomEditor";
import { BomBrowseTable } from "@/components/manufacturing/BomBrowseTable";
import { Button } from "@/components/common/Button";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Bom } from "@/data/types";

export const Boms = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bomId } = useParams<{ bomId?: string }>();
  const [searchParams] = useSearchParams();

  const liveBoms = useApi(() => api.boms(), []);
  const liveProducts = useApi(() => api.products({ limit: 2000 }), []);
  const boms = liveBoms.data ?? [];
  const products = liveProducts.data ?? [];

  // `/manufacturing/boms/new` uses its own route (no :bomId param); only
  // `/manufacturing/boms/:bomId` supplies bomId (including legacy "new" hits).
  const isNew =
    location.pathname.endsWith("/boms/new") || bomId === "new";
  const editingId = bomId && bomId !== "new" ? bomId : null;

  const [editingBom, setEditingBom] = useState<Bom | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId) {
      setEditingBom(null);
      setLoadErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await api.getBom(editingId);
        if (!cancelled) {
          setEditingBom(fresh);
          setLoadErr(null);
        }
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const loading = liveBoms.loading || liveProducts.loading;
  const errorObj = liveBoms.error ?? liveProducts.error;

  if (loading) {
    return (
      <div className="h-full min-h-0 grid place-items-center text-body-sm text-ink-muted">
        Loading BOMs…
      </div>
    );
  }

  if (errorObj) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-body font-semibold text-ink">Could not load BOMs</p>
        <p className="text-body-sm text-ink-muted">{(errorObj as Error).message}</p>
        <Button
          size="sm"
          onClick={() => {
            void liveBoms.refetch();
            void liveProducts.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (isNew || editingId) {
    if (editingId && !editingBom && !loadErr) {
      return (
        <div className="h-full grid place-items-center text-body-sm text-ink-muted">
          Loading BOM…
        </div>
      );
    }
    if (loadErr) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-body font-semibold text-ink">BOM not found</p>
          <p className="text-body-sm text-ink-muted">{loadErr}</p>
          <Button size="sm" onClick={() => navigate("/manufacturing/boms")}>
            Back to list
          </Button>
        </div>
      );
    }
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {banner && (
          <div className="px-4 py-2 bg-success-soft text-success text-body-sm border-b border-border shrink-0">
            {banner}
          </div>
        )}
        <div className="flex-1 min-h-0">
        <BomEditor
          variant="page"
          bom={isNew ? null : editingBom}
          seedProductId={searchParams.get("productId") ?? undefined}
          seedVariantId={searchParams.get("variantId") ?? undefined}
          products={products}
          onClose={() => navigate("/manufacturing/boms")}
          onSaved={(id, message) => {
            setBanner(message);
            void liveBoms.refetch();
            navigate(`/manufacturing/boms/${id}`);
          }}
        />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {banner && (
        <div className="px-4 py-2 bg-success-soft text-success text-body-sm border-b border-border shrink-0">
          {banner}
        </div>
      )}
      <div className="flex-1 min-h-0">
      <BomBrowseTable
        boms={boms}
        products={products}
        onCreate={({ productId, variantId } = {}) => {
          const params = new URLSearchParams();
          if (productId) params.set("productId", productId);
          if (variantId) params.set("variantId", variantId);
          const qs = params.toString();
          navigate(`/manufacturing/boms/new${qs ? `?${qs}` : ""}`);
        }}
        onClone={async (b) => {
          try {
            const cloned = (await api.cloneBom(b.id)) as { id: string };
            await liveBoms.refetch();
            setBanner(`Cloned BOM ${b.sku} — opened the new revision.`);
            navigate(`/manufacturing/boms/${cloned.id}`);
          } catch (e) {
            setBanner((e as Error).message);
          }
        }}
        onChanged={() => {
          void liveBoms.refetch();
          setBanner("BOM updated.");
        }}
      />
      </div>
    </div>
  );
};
