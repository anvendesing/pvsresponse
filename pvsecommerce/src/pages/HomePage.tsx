// Home page. Shows the hero, the 10-category grid, and two
// underlined sections: Best Sellers and Combos. Both sections pull
// from /storefront-mock/catalog - we don't curate them server-side
// yet, so:
//   - Best sellers = first 4 in-stock single-or-variant products
//   - Combos       = first 4 products whose name contains "combo"
//                    (falls back to the next 4 if none match).

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CATEGORIES, bucketFor } from "@/data/categories";
import { useCatalog } from "@/state/CatalogContext";
import { ProductCard } from "@/components/ProductCard";
import type { CatalogProduct } from "@/lib/api";

const matches = (p: CatalogProduct, q: string): boolean => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    p.name.toLowerCase().includes(needle) ||
    p.sku.toLowerCase().includes(needle) ||
    p.category.toLowerCase().includes(needle) ||
    p.variants.some((v) => v.sku.toLowerCase().includes(needle))
  );
};

export const HomePage = () => {
  const { products, loading, error } = useCatalog();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";

  const filtered = useMemo(() => products.filter((p) => matches(p, q)), [products, q]);

  const bestSellers = useMemo(() => filtered.slice(0, 4), [filtered]);
  const combos = useMemo(() => {
    const direct = filtered.filter((p) => /combo/i.test(p.name));
    if (direct.length >= 4) return direct.slice(0, 4);
    return [...direct, ...filtered.filter((p) => !/combo/i.test(p.name))].slice(
      0,
      4
    );
  }, [filtered]);

  return (
    <>
      <section className="hero-section">
        <div className="hero-row">
          <div>
            <span className="hero-tag">100% Chemical-free · Farm-direct</span>
            <h1 className="hero-title">
              Healthy <em>Millets,</em>
              <br /> traditional taste.
            </h1>
            <p className="hero-subtitle">
              Hand-picked, sun-dried, stone-ground - delivered to your door.
              Shop wood-pressed oils, sprouted millet flours, herbal soaps,
              and more from our family of small farmers.
            </p>
            <Link to="/category/millets" className="btn btn-green">
              Shop Now
            </Link>
          </div>
          <div className="hero-art">
            <img
              src="/brand/farm-portrait.jpg"
              alt="Prakruthivanam organic farm — lush green fields in Andhra Pradesh"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section className="categories-section section-padding" id="categories">
        <header className="section-header">
          <span className="section-eyebrow">Shop by Category</span>
          <h2 className="section-title">A garden's worth of goodness</h2>
        </header>
        <div className="categories-exact-grid">
          {CATEGORIES.map((c) => (
            <Link key={c.id} to={`/category/${c.id}`} className="category-card">
              <div className="category-card-inner">{c.icon()}</div>
              <span className="category-card-badge">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="catalog-columns-section section-padding" id="catalog">
        <div className="catalog-columns-row">
          <div>
            <h2 className="catalog-column-title">Best Selling Products</h2>
            {loading ? (
              <SkeletonGrid />
            ) : (
              <div className="catalog-column-grid">
                {bestSellers.length > 0 ? (
                  bestSellers.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      badge={badgeFor(p, "best")}
                    />
                  ))
                ) : (
                  <EmptyHint message="No best sellers yet." />
                )}
              </div>
            )}
          </div>
          <div>
            <h2 className="catalog-column-title">Combos</h2>
            {loading ? (
              <SkeletonGrid />
            ) : (
              <div className="catalog-column-grid">
                {combos.length > 0 ? (
                  combos.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      badge={badgeFor(p, "combo")}
                    />
                  ))
                ) : (
                  <EmptyHint message="No combos available." />
                )}
              </div>
            )}
          </div>
        </div>
        {error && (
          <p
            style={{
              textAlign: "center",
              marginTop: "2rem",
              color: "var(--color-error)",
              background: "var(--neutral-white)",
              padding: "0.85rem",
              borderRadius: "var(--radius-md)",
              maxWidth: 480,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Could not load catalog: {error}
          </p>
        )}
      </section>
    </>
  );
};

const badgeFor = (p: CatalogProduct, kind: "best" | "combo"): string => {
  if (kind === "combo") return "Combo Save";
  const bucket = bucketFor(p.category, p.name);
  if (bucket === "millets") return "Stone Ground";
  if (bucket === "oils") return "Wood Pressed";
  if (bucket === "wellness") return "Herbal";
  if (bucket === "sweeteners") return "Forest Honey";
  return "Best Seller";
};

const SkeletonGrid = () => (
  <div className="catalog-column-grid">
    {[0, 1, 2, 3].map((i) => (
      <div
        key={i}
        className="product-card"
        style={{ background: "rgba(255,255,255,0.5)" }}
      />
    ))}
  </div>
);

const EmptyHint = ({ message }: { message: string }) => (
  <div
    style={{
      gridColumn: "1 / -1",
      padding: "2rem",
      textAlign: "center",
      background: "var(--neutral-white)",
      borderRadius: "var(--radius-md)",
      color: "var(--neutral-gray)",
    }}
  >
    {message}
  </div>
);
