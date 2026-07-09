// Concern listing — live infinite scroll + lazy images.
// Fallback paginated version: /concern-paginated/:slug

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCatalog } from "@/state/CatalogContext";
import { useConcerns } from "@/state/ConcernsContext";
import { usePlatform } from "@/state/PlatformContext";
import { InfiniteProductGrid } from "@/components/listing/InfiniteProductGrid";
import { CheckboxRow, productInStock } from "@/components/listing/listingShared";
import { sortProducts, type ProductSortOrder } from "@/lib/catalogSearch";

export const ConcernPageInfinite = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { bySlug, concerns, loading: concernsLoading } = useConcerns();
  const concern = slug ? bySlug.get(slug) : undefined;
  const { products, loading: productsLoading, error } = useCatalog();
  const { isPhone } = usePlatform();

  const [showInStock, setShowInStock] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<ProductSortOrder>("default");

  useEffect(() => {
    if (filterOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [filterOpen]);

  const inBucket = useMemo(() => {
    if (!concern) return [];
    return products.filter((p) => p.concernSlugs?.includes(concern.slug));
  }, [products, concern]);

  const filtered = useMemo(() => {
    let list = inBucket.filter((p) => {
      const inStock = productInStock(p);
      if (inStock && !showInStock) return false;
      if (!inStock && !showOutOfStock) return false;
      return true;
    });
    if (sortOrder === "price-asc") list = sortProducts(list, "price-asc");
    if (sortOrder === "price-desc") list = sortProducts(list, "price-desc");
    return list;
  }, [inBucket, showInStock, showOutOfStock, sortOrder]);

  const gridResetKey = `${slug ?? ""}|${showInStock}|${showOutOfStock}|${sortOrder}`;

  if (!concern && concernsLoading) {
    return (
      <div className="listing-page">
        <div className={`listing-row${isPhone ? " listing-row--mobile" : ""}`}>
          {!isPhone && (
            <aside className="listing-sidebar">
              <div className="sidebar-block-title">Concerns</div>
              <ul className="sidebar-category-links">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i}>
                    <span className="muted">Loading…</span>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className="listing-grid-area">
            <div className="listing-toolbar">
              <h1 className="listing-grid-title">&nbsp;</h1>
            </div>
            <InfiniteProductGrid products={[]} loading emptyMessage="" />
          </div>
        </div>
      </div>
    );
  }

  if (!concern) {
    return (
      <div className="listing-page">
        <div className="listing-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card-soft" style={{ textAlign: "center" }}>
            <h2>Concern not found</h2>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              We don&apos;t have a concern for &quot;{slug}&quot;.
            </p>
            {concerns.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  marginTop: "0.65rem",
                }}
              >
                {concerns.map((c) => (
                  <Link
                    key={c.id}
                    to={`/concern/${c.slug}`}
                    className="btn"
                    style={{ padding: "0.4rem 0.85rem", fontSize: "0.85rem" }}
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-green"
              style={{ marginTop: "1.25rem" }}
              onClick={() => navigate("/")}
            >
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const grid = (
    <>
      {error && (
        <div
          className="card-soft"
          style={{
            marginBottom: "1rem",
            color: "var(--color-error)",
            background: "#fef2f2",
          }}
        >
          Could not load catalog: {error}
        </div>
      )}
      <InfiniteProductGrid
        products={filtered}
        loading={productsLoading}
        resetKey={gridResetKey}
        emptyMessage="No products match these filters."
      />
    </>
  );

  return (
    <div className="listing-page">
      {isPhone ? (
        <>
          <div className="mobile-filter-bar">
            <button
              type="button"
              className="mobile-filter-btn"
              onClick={() => setFilterOpen(true)}
              aria-label="Open filters"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="4" y1="6" x2="16" y2="6" />
                <line x1="8" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="12" y2="18" />
              </svg>
              Filters
              {(!showInStock || showOutOfStock) && <span className="mobile-filter-dot" />}
            </button>

            <div className="mobile-sort-row">
              <label htmlFor="concern-sort-select-v2" className="sr-only">
                Sort by
              </label>
              <select
                id="concern-sort-select-v2"
                className="mobile-sort-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
              >
                <option value="default">Sort: Default</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            <span className="mobile-filter-count muted">
              {filtered.length} {filtered.length === 1 ? "product" : "products"}
            </span>
          </div>

          <div className="listing-grid-area listing-grid-area--mobile">
            <h1 className="listing-grid-title listing-grid-title--mobile">{concern.name}</h1>
            {concern.description && (
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                {concern.description}
              </p>
            )}
            {grid}
          </div>

          {filterOpen && (
            <>
              <div
                className="filter-sheet-backdrop"
                onClick={() => setFilterOpen(false)}
                aria-hidden="true"
              />
              <div className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filters">
                <div className="filter-sheet__header">
                  <h2 className="filter-sheet__title">Filters</h2>
                  <button
                    type="button"
                    className="filter-sheet__close"
                    onClick={() => setFilterOpen(false)}
                    aria-label="Close filters"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="filter-sheet__body">
                  <div className="filter-sheet__section-title">Shop by Concern</div>
                  <div className="filter-sheet__chips">
                    {concerns.map((c) => (
                      <Link
                        key={c.id}
                        to={`/concern/${c.slug}`}
                        className={`filter-chip${c.slug === concern.slug ? " active" : ""}`}
                        onClick={() => setFilterOpen(false)}
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>

                  <div className="filter-sheet__section-title" style={{ marginTop: "1.25rem" }}>
                    Availability
                  </div>
                  <div className="filter-sheet__check-group">
                    <CheckboxRow
                      checked={showInStock}
                      label="In Stock"
                      onToggle={() => setShowInStock((v) => !v)}
                    />
                    <CheckboxRow
                      checked={showOutOfStock}
                      label="Out of Stock"
                      onToggle={() => setShowOutOfStock((v) => !v)}
                    />
                  </div>
                </div>

                <div className="filter-sheet__footer">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowInStock(true);
                      setShowOutOfStock(false);
                      setSortOrder("default");
                    }}
                  >
                    Reset
                  </button>
                  <button type="button" className="btn btn-green" onClick={() => setFilterOpen(false)}>
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="listing-row">
          <aside className="listing-sidebar">
            <div className="sidebar-block-title">Shop by Concern</div>
            <ul className="sidebar-category-links">
              {concerns.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/concern/${c.slug}`}
                    className={c.slug === concern.slug ? "active" : ""}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="sidebar-block-title" style={{ marginTop: "1rem" }}>
              Availability
            </div>
            <CheckboxRow
              checked={showInStock}
              label="In Stock"
              onToggle={() => setShowInStock((v) => !v)}
            />
            <CheckboxRow
              checked={showOutOfStock}
              label="Out of Stock"
              onToggle={() => setShowOutOfStock((v) => !v)}
            />
          </aside>

          <div className="listing-grid-area">
            <div className="listing-toolbar">
              <div>
                <h1 className="listing-grid-title">{concern.name}</h1>
                {concern.description && (
                  <p className="muted" style={{ marginTop: "0.35rem", maxWidth: "42rem" }}>
                    {concern.description}
                  </p>
                )}
              </div>
              <div className="listing-toolbar-actions">
                <span className="muted">
                  {filtered.length} {filtered.length === 1 ? "product" : "products"}
                </span>
                <select
                  className="listing-sort-select"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as ProductSortOrder)}
                  aria-label="Sort products"
                >
                  <option value="default">Sort: Default</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                </select>
              </div>
            </div>
            {grid}
          </div>
        </div>
      )}
    </div>
  );
};
