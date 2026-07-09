import { useEffect, useRef, useState } from "react";

/** Appends `pageSize` items at a time when the sentinel enters the viewport. */
export const useInfiniteScroll = (
  total: number,
  pageSize = 9,
  resetKey = ""
) => {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [total, pageSize, resetKey]);

  const hasMore = visibleCount < total;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + pageSize, total));
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, pageSize, total, visibleCount]);

  return { visibleCount, sentinelRef, hasMore };
};
