// Concern listing page — same layout as CategoryPage but filters products
// by concernSlugs (many-to-many at product level).

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCatalog } from "@/state/CatalogContext";
import { useConcerns } from "@/state/ConcernsContext";
import { ProductCard } from "@/components/ProductCard";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/assets/icons";

const PAGE_SIZE = 9;

const productInStock = (p: { inStock: boolean; variants: { inStock: boolean }[] }): boolean => {
  if (p.variants.length > 0) return p.variants.some((v) => v.inStock);
  return p.inStock;
};

export const ConcernPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { bySlug, concerns, loading: concernsLoading } = useConcerns();
  const concern = slug ? bySlug.get(slug) : undefined;
  const { products, loading: productsLoading, error } = useCatalog();
  const [showInStock, setShowInStock] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [slug]);

  const inBucket = useMemo(() => {
    if (!concern) return [];
    return products.filter((p) => p.concernSlugs?.includes(concern.slug));
  }, [products, concern]);

  const filtered = useMemo(() => {
    return inBucket.filter((p) => {
      const inStock = productInStock(p);
      if (inStock && !showInStock) return false;
      if (!inStock && !showOutOfStock) return false;
      return true;
    });
  }, [inBucket, showInStock, showOutOfStock]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!concern && concernsLoading) {
    return (
      <div className="listing-page">
        <div className="listing-row">
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
          <div className="listing-grid-area">
            <div className="listing-toolbar">
              <h1 className="listing-grid-title">&nbsp;</h1>
            </div>
            <div className="listing-products-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="product-card" />
              ))}
            </div>
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
              <>
                <p className="muted" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
                  Try one of these instead:
                </p>
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
                      style={{
                        padding: "0.4rem 0.85rem",
                        fontSize: "0.85rem",
                        background: "var(--neutral-white)",
                        border: "1px solid var(--neutral-border, #e5e7eb)",
                        color: "var(--color-ink, #111)",
                      }}
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </>
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

  return (
    <div className="listing-page">
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
            onToggle={() => {
              setShowInStock((v) => !v);
              setPage(1);
            }}
          />
          <CheckboxRow
            checked={showOutOfStock}
            label="Out of Stock"
            onToggle={() => {
              setShowOutOfStock((v) => !v);
              setPage(1);
            }}
          />
        </aside>

        <div className="listing-grid-area">
          <div className="listing-toolbar">
            <h1 className="listing-grid-title">{concern.name}</h1>
            {concern.description && (
              <p className="muted" style={{ marginTop: "0.35rem", maxWidth: "42rem" }}>
                {concern.description}
              </p>
            )}
            <span className="muted">
              {filtered.length} {filtered.length === 1 ? "product" : "products"}
            </span>
          </div>

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

          {productsLoading ? (
            <div className="listing-products-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="product-card" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="card-soft" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
              <p className="muted">
                No products tagged for this concern yet. Check back soon.
              </p>
            </div>
          ) : (
            <div className="listing-products-grid">
              {visible.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <div className="pagination">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeftIcon />
              </button>
              {Array.from({ length: pageCount }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pagination-btn ${i + 1 === currentPage ? "active" : ""}`}
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={currentPage === pageCount}
                aria-label="Next page"
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CheckboxRow = ({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className={`filter-checkbox-row ${checked ? "checked" : ""}`}
    onClick={onToggle}
    style={{ width: "100%", textAlign: "left", background: "transparent" }}
  >
    <span className="check">{checked && <CheckIcon />}</span>
    <span>{label}</span>
  </button>
);
