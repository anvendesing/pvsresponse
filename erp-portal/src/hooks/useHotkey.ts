import { useEffect } from "react";

type Modifier = "ctrl" | "alt" | "shift" | "meta";
type Hotkey = {
  key: string;
  modifiers?: Modifier[];
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
};

export const useHotkey = (hotkeys: Hotkey | Hotkey[], deps: unknown[] = []) => {
  useEffect(() => {
    const list = Array.isArray(hotkeys) ? hotkeys : [hotkeys];
    const onKey = (e: KeyboardEvent) => {
      for (const h of list) {
        const mods = h.modifiers ?? [];
        const ctrl = mods.includes("ctrl");
        const meta = mods.includes("meta");
        const alt = mods.includes("alt");
        const shift = mods.includes("shift");

        const ctrlOk = ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
        const metaOk = meta ? e.metaKey : true;
        const altOk = alt ? e.altKey : !e.altKey;
        const shiftOk = shift ? e.shiftKey : !e.shiftKey;

        const keyOk = e.key.toLowerCase() === h.key.toLowerCase();
        if (keyOk && ctrlOk && metaOk && altOk && shiftOk) {
          if (h.preventDefault !== false) e.preventDefault();
          h.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};
