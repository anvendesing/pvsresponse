// Full-catalog search results — /search?q=

import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCatalog } from "@/state/CatalogContext";
import { usePlatform } from "@/state/PlatformContext";
import { InfiniteProductGrid } from "@/components/listing/InfiniteProductGrid";
import { catalogMatches, sortProducts, type ProductSortOrder } from "@/lib/catalogSearch";
import { track } from "@/lib/activity";

export const SearchPage = () => {
  const { products, loading, error } = useCatalog();
  const { isPhone } = usePlatform();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sortOrder = (params.get("sort") as ProductSortOrder) ?? "default";

  const prevQ = useRef(q);
  useEffect(() => {
    if (q && q !== prevQ.current) {
      track("search", { meta: { q } });
    }
    prevQ.current = q;
  }, [q]);

  const filtered = useMemo(() => {
    const matched = products.filter((p) => catalogMatches(p, q));
    return sortProducts(matched, sortOrder);
  }, [products, q, sortOrder]);

  const clearSearch = () => setParams({});

  const setSort = (next: ProductSortOrder) => {
    const nextParams = new URLSearchParams(params);
    if (next === "default") nextParams.delete("sort");
    else nextParams.set("sort", next);
    setParams(nextParams);
  };

  return (
    <div className="listing-page">
      <div className={`listing-row${isPhone ? " listing-row--mobile" : ""}`} style={{ gridTemplateColumns: "1fr" }}>
        <div className="listing-grid-area listing-grid-area--mobile">
          <div className="listing-toolbar search-page-toolbar">
            <div>
              <h1 className="listing-grid-title">Search</h1>
              {q ? (
                <p className="search-active-banner">
                  Results for &ldquo;{q}&rdquo; — {filtered.length}{" "}
                  {filtered.length === 1 ? "product" : "products"}
                  <button type="button" className="search-clear-btn" onClick={clearSearch}>
                    Clear
                  </button>
                </p>
              ) : (
                <p className="muted">Type a product name, SKU, or category in the search bar.</p>
              )}
            </div>
            {q && (
              <select
                className="listing-sort-select"
                value={sortOrder}
                onChange={(e) => setSort(e.target.value as ProductSortOrder)}
                aria-label="Sort results"
              >
                <option value="default">Sort: Default</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            )}
          </div>

          {error && (
            <div className="card-soft search-error-banner">
              Could not load catalog: {error}
            </div>
          )}

          {!q ? (
            <div className="card-soft" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                Search our full farm-fresh catalog — oils, millets, wellness, and more.
              </p>
              <Link to="/category/grains-pulses-flours" className="btn btn-green">
                Browse categories
              </Link>
            </div>
          ) : (
            <InfiniteProductGrid
              products={filtered}
              loading={loading}
              resetKey={`${q}|${sortOrder}`}
              emptyMessage={`No products match "${q}". Try a different spelling or browse by category.`}
            />
          )}
        </div>
      </div>
    </div>
  );
};
