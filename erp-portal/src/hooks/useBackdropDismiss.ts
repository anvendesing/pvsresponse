/**
 * Safe backdrop dismiss for modals and slide-over panels.
 *
 * Only calls `onDismiss` when the pointer is pressed and released on the
 * backdrop itself. Dragging out of an input to adjust text selection
 * (mousedown inside the panel, mouseup on the dimmed area) will not close.
 *
 * Uses a data flag on the backdrop element so callers can spread the result
 * inline without a React hook.
 */
export function backdropDismissProps(onDismiss: () => void) {
  return {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.dataset.backdropArm = "1";
      }
    },
    onMouseUp: (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      if (
        el.dataset.backdropArm === "1" &&
        e.target === e.currentTarget
      ) {
        onDismiss();
      }
      delete el.dataset.backdropArm;
    },
  };
}

/** Hook wrapper — prefer `backdropDismissProps` when spreading on the backdrop. */
export function useBackdropDismiss(onDismiss: () => void) {
  return { backdropProps: backdropDismissProps(onDismiss) };
}
