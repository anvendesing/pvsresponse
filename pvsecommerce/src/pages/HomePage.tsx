// Home page: hero, category grid (desktop), and a full best-sellers catalog
// grid. Combos are deferred — nav links to /bulk-order instead.

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCategoryIcon } from "@/data/categories";
import { useCatalog } from "@/state/CatalogContext";
import { useCategories } from "@/state/CategoriesContext";
import { usePlatform } from "@/state/PlatformContext";
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
  const { categories, categoryImageUrl } = useCategories();
  const { isPhone } = usePlatform();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";

  const bestSellers = useMemo(
    () => products.filter((p) => p.bestSellerEnabled && matches(p, q)),
    [products, q]
  );

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
            <Link to="/category/grains-pulses-flours" className="btn btn-green">
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

      {!isPhone && (
        <section className="categories-section section-padding" id="categories">
          <header className="section-header">
            <span className="section-eyebrow">Shop by Category</span>
            <h2 className="section-title">A garden's worth of goodness</h2>
          </header>
          <div className="categories-exact-grid">
            {categories.map((c) => {
              const Icon = getCategoryIcon(c.slug);
              return (
                <Link key={c.id} to={`/category/${c.slug}`} className="category-card">
                  <div className="category-card-inner">
                    <img
                      src={categoryImageUrl(c)}
                      alt={c.name}
                      className="category-card-img"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty(
                          "display",
                          "flex"
                        );
                      }}
                    />
                    {Icon && (
                      <span className="category-card-icon-fallback" style={{ display: "none" }}>
                        <Icon />
                      </span>
                    )}
                  </div>
                  <span className="category-card-badge">{c.name}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="catalog-columns-section section-padding" id="catalog">
        <div className="home-catalog-inner">
          <h2 className="catalog-column-title">Best Selling Products</h2>
          {loading ? (
            <SkeletonGrid />
          ) : bestSellers.length > 0 ? (
            <div className="best-sellers-grid">
              {bestSellers.map((p) => (
                <ProductCard key={p.id} product={p} badge={badgeFor(p)} />
              ))}
            </div>
          ) : (
            <EmptyHint message={q ? "No best sellers match your search." : "No best sellers configured yet."} />
          )}
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

const badgeFor = (p: CatalogProduct): string => {
  const slug = p.categorySlug ?? "";
  if (slug === "millets" || slug === "millets-millet-products") return "Stone Ground";
  if (slug === "oils" || slug === "oils-oil-seeds") return "Wood Pressed";
  if (slug === "wellness" || slug === "personal-care-wellness") return "Herbal";
  if (slug === "sweeteners" || slug === "natural-sweeteners") return "Forest Honey";
  return "Best Seller";
};

const SkeletonGrid = () => (
  <div className="best-sellers-grid">
    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      <div
        key={i}
        className="product-card"
        style={{ background: "rgba(255,255,255,0.5)", minHeight: 320 }}
      />
    ))}
  </div>
);

const EmptyHint = ({ message }: { message: string }) => (
  <div
    style={{
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
