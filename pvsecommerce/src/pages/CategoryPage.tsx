// Category listing page. Sidebar lists all 10 buckets; main grid
// dynamically pulls products from the catalog whose name/category
// fall into the active bucket. Availability filter (in-stock /
// out-of-stock) operates on the displayed list. Pagination is
// client-side and 9 items per page to match the design spec.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CATEGORIES, bucketFor, getCategory } from "@/data/categories";
import { useCatalog } from "@/state/CatalogContext";
import { ProductCard } from "@/components/ProductCard";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/assets/icons";

const PAGE_SIZE = 9;

const productInStock = (p: { stockOnHand: number; variants: { stockOnHand: number }[] }): boolean => {
  if (p.variants.length > 0) return p.variants.some((v) => v.stockOnHand > 0);
  return p.stockOnHand > 0;
};

export const CategoryPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const cat = getCategory(slug);
  const { products, loading, error } = useCatalog();
  const [showInStock, setShowInStock] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [page, setPage] = useState(1);

  const inBucket = useMemo(() => {
    if (!cat) return [];
    return products.filter(
      (p) => bucketFor(p.category, p.name) === cat.id
    );
  }, [products, cat]);

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
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  if (!cat) {
    return (
      <div className="listing-page">
        <div className="listing-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card-soft" style={{ textAlign: "center" }}>
            <h2>Category not found</h2>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              We don't carry "{slug}".
            </p>
            <button
              type="button"
              className="btn btn-green"
              style={{ marginTop: "1rem" }}
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
          <div className="sidebar-block-title">Categories</div>
          <ul className="sidebar-category-links">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/category/${c.id}`}
                  className={c.id === cat.id ? "active" : ""}
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
            <h1 className="listing-grid-title">{cat.name}</h1>
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

          {loading ? (
            <div className="listing-products-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="product-card" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div
              className="card-soft"
              style={{ textAlign: "center", padding: "3rem 1.5rem" }}
            >
              <p className="muted">
                No products in this category yet. Check back soon - we add new
                farm-fresh items every week.
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
