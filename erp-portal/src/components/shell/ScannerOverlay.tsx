import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { api } from "@/lib/api";
import type { Product } from "@/data/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const ScannerOverlay = ({ open, onClose }: Props) => {
  const [code, setCode] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode("");
      setHits([]);
      setTimeout(() => inputRef.current?.focus(), 30);
      if (products.length === 0) {
        void api.products({ limit: 500 }).then(setProducts).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!code) {
      setHits([]);
      return;
    }
    const c = code.toLowerCase();
    setHits(
      products
        .filter(
          (p) =>
            p.barcode.toLowerCase().includes(c) ||
            p.sku.toLowerCase().includes(c) ||
            p.name.toLowerCase().includes(c) ||
            (p.variants ?? []).some(
              (v) =>
                v.sku.toLowerCase().includes(c) ||
                (v.barcode ?? "").toLowerCase().includes(c)
            )
        )
        .slice(0, 5)
    );
  }, [code, products]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-start justify-center pt-[16vh] animate-fade-in"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="w-full max-w-[520px] bg-surface rounded-xl shadow-e3 border border-border mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border bg-primary text-white">
          <div className="flex items-center gap-2 font-semibold">
            <ScanLine size={18} />
            Scanner Input
          </div>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
              placeholder="Scan barcode or type SKU…"
              className="w-full h-12 pl-12 pr-3 bg-canvas border-2 border-primary rounded-md text-body font-mono outline-none"
            />
            <ScanLine
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-primary animate-pulse"
            />
          </div>
          {hits.length > 0 ? (
            <div className="border border-border rounded-md divide-y divide-border max-h-[280px] overflow-y-auto">
              {hits.map((h) => (
                <button
                  key={h.id}
                  className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-canvas"
                  onClick={onClose}
                >
                  <div className="h-9 w-9 grid place-items-center rounded-md bg-primary-50 text-primary font-bold text-caption">
                    {h.uom}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-body-sm font-semibold text-ink truncate">{h.name}</div>
                    <div className="text-caption text-ink-muted font-mono">
                      {h.sku} · {h.barcode}
                    </div>
                  </div>
                  <div className="text-right tnum">
                    <div className="text-body-sm font-semibold">{h.stockOnHand}</div>
                    <div className="text-caption text-ink-muted">in stock</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-md py-10 text-center">
              <div className="text-body-sm text-ink-muted">Awaiting barcode input…</div>
              <div className="text-caption text-ink-muted mt-1">
                Scanner ready · Avg. response &lt; 50ms
              </div>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-caption text-ink-muted">
              Press <span className="kbd">Esc</span> to close
            </span>
            <Button size="sm" variant="primary" disabled={hits.length === 0} onClick={onClose}>
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
