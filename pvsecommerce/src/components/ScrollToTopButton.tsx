import { useEffect, useState } from "react";
import { ChevronUpIcon } from "@/assets/icons";
import { usePlatform } from "@/state/PlatformContext";

const SHOW_AFTER_PX = 320;

export const ScrollToTopButton = () => {
  const { isPhone } = usePlatform();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={`scroll-to-top${isPhone ? " scroll-to-top--phone" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      title="Back to top"
    >
      <ChevronUpIcon />
    </button>
  );
};
