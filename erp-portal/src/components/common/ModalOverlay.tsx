import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { backdropDismissProps } from "@/hooks/useBackdropDismiss";

type ModalOverlayProps = {
  onClose: () => void;
  children: ReactNode;
  /** z-index and other backdrop-only classes (default includes bg-ink/40). */
  className?: string;
  /** Layout for the panel, e.g. grid place-items-end for right drawers. */
  placementClassName?: string;
};

/**
 * Full-screen modal / drawer backdrop. Dismisses only on a full click on the
 * dimmed area, not when the user drags out of a text field while selecting.
 */
export function ModalOverlay({
  onClose,
  children,
  className,
  placementClassName = "grid place-items-center",
}: ModalOverlayProps) {
  return (
    <div
      className={cn("fixed inset-0 bg-ink/40", placementClassName, className)}
      {...backdropDismissProps(onClose)}
    >
      {children}
    </div>
  );
}
