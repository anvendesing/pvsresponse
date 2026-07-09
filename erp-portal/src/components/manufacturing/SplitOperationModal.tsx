import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { X } from "lucide-react";
import type { ProductionOrder } from "@/data/types";
import { SplitOperationForm } from "./SplitOperationForm";

interface Props {
  mo: ProductionOrder;
  bomOperationId: string;
  operationLabel: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export const SplitOperationModal = ({
  mo,
  bomOperationId,
  operationLabel,
  onClose,
  onSaved,
}: Props) => (
  <div
    className="fixed inset-0 z-[80] bg-ink/40 grid place-items-center"
    {...backdropDismissProps(onClose)}
  >
    <div
      className="bg-surface w-[560px] max-w-[95vw] rounded-lg elevation-3 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-caption text-ink-muted uppercase font-semibold">
            Split operation
          </div>
          <div className="text-body-sm font-medium">
            {operationLabel} · {mo.orderNo}
          </div>
        </div>
        <button
          onClick={onClose}
          className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
        >
          <X size={18} />
        </button>
      </div>

      <SplitOperationForm
        bare
        mo={mo}
        bomOperationId={bomOperationId}
        operationLabel={operationLabel}
        onCancel={onClose}
        onSaved={onSaved}
      />
    </div>
  </div>
);
