// Horizontal scrolling category chip strip for mobile.
// Each chip = small circular thumbnail + short label.
// Active chip is derived from the current URL path.

import { Link, useLocation } from "react-router-dom";
import { useCategories } from "@/state/CategoriesContext";

export const CategoryChipStrip = () => {
  const { categories, categoryImageUrl } = useCategories();
  const location = useLocation();

  if (categories.length === 0) return null;

  return (
    <div className="category-chip-strip" role="navigation" aria-label="Shop by category">
      <div className="category-chip-strip__scroll">
        <Link
          to="/"
          className={`category-chip${location.pathname === "/" && !location.search ? " active" : ""}`}
        >
          <span className="category-chip__icon all-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </span>
          <span className="category-chip__label">All</span>
        </Link>

        {categories.map((c) => {
          const isActive = location.pathname === `/category/${c.slug}`;
          const imgUrl = categoryImageUrl(c);

          return (
            <Link
              key={c.id}
              to={`/category/${c.slug}`}
              className={`category-chip${isActive ? " active" : ""}`}
              aria-label={c.name}
            >
              <span className="category-chip__icon">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    className="category-chip__img"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="category-chip__img-placeholder" />
                )}
              </span>
              <span className="category-chip__label">
                {c.name.split(" ")[0]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
