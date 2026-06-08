// Scroll-position helpers for the mobile pick-list walk flow.
// The list scrolls inside <main> in MobileShell; when the worker
// drills into a line and comes back, we restore focus near the last
// line they touched so a 21-line order doesn't jump to the top.

const storageKey = (pickListId: string) => `pick-scroll:${pickListId}`;

export const savePickScrollTarget = (pickListId: string, itemId: string) => {
  try {
    sessionStorage.setItem(storageKey(pickListId), itemId);
  } catch {
    /* private mode / quota — ignore */
  }
};

export const consumePickScrollTarget = (pickListId: string): string | null => {
  try {
    const v = sessionStorage.getItem(storageKey(pickListId));
    if (v) sessionStorage.removeItem(storageKey(pickListId));
    return v;
  } catch {
    return null;
  }
};

type PickLine = { id: string; qtyToPick: number; qtyPicked: number };

/** First unpicked line after `currentItemId` in walk order, else before. */
export const nextUnpickedAfter = (
  items: PickLine[],
  currentItemId: string
): string => {
  const pending = (i: PickLine) => i.qtyToPick > 0 && i.qtyPicked === 0;
  const idx = items.findIndex((i) => i.id === currentItemId);
  const after = items.slice(idx + 1).find(pending);
  if (after) return after.id;
  const before = items.slice(0, idx).find(pending);
  return before?.id ?? currentItemId;
};

export const scrollPickItemIntoView = (itemId: string) => {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-pick-item-id="${itemId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "instant" });
  });
};
