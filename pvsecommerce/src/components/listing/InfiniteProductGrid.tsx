import type { CatalogProduct } from "@/lib/api";
import { ProductCardLazy } from "@/components/ProductCardLazy";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { LISTING_CHUNK_SIZE } from "./listingShared";

interface Props {
  products: CatalogProduct[];
  loading: boolean;
  emptyMessage: string;
  resetKey?: string;
  chunkSize?: number;
}

export const InfiniteProductGrid = ({
  products,
  loading,
  emptyMessage,
  resetKey = "",
  chunkSize = LISTING_CHUNK_SIZE,
}: Props) => {
  const { visibleCount, sentinelRef, hasMore } = useInfiniteScroll(
    products.length,
    chunkSize,
    resetKey
  );
  const visible = products.slice(0, visibleCount);

  if (loading) {
    return (
      <div className="listing-products-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="product-card product-card--skeleton">
            <div className="product-card-lazy-placeholder" aria-hidden="true" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div
        className="card-soft"
        style={{ textAlign: "center", padding: "3rem 1.5rem" }}
      >
        <p className="muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="listing-products-grid">
        {visible.map((p) => (
          <ProductCardLazy key={p.id} product={p} />
        ))}
      </div>
      {hasMore && (
        <div
          ref={sentinelRef}
          className="infinite-scroll-sentinel"
          aria-live="polite"
        >
          <span className="muted">Loading more products…</span>
        </div>
      )}
    </>
  );
};
