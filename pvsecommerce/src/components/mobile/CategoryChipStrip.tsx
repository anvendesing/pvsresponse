// Smart chip strip — shows category chips on most pages,
// but switches to concern chips when browsing /concern/* routes.
// Hidden on non-browsing pages (account, cart, checkout, etc).

import { Link, useLocation } from "react-router-dom";
import { useCategories } from "@/state/CategoriesContext";
import { useConcerns } from "@/state/ConcernsContext";

const HIDDEN_ROUTES = [
  "/account", "/cart", "/checkout", "/login",
  "/track", "/enquiry", "/order", "/bulk-order",
];

const isConcernRoute = (p: string) =>
  p === "/concerns" || p.startsWith("/concern/");

const isHidden = (p: string) =>
  HIDDEN_ROUTES.some((r) => p === r || p.startsWith(r + "/"));

export const CategoryChipStrip = () => {
  const { categories, categoryImageUrl } = useCategories();
  const { concerns, concernImageUrl } = useConcerns();
  const location = useLocation();

  if (isHidden(location.pathname)) return null;

  const onConcerns = isConcernRoute(location.pathname);

  if (!onConcerns) {
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
              <Link key={c.id} to={`/category/${c.slug}`} className={`category-chip${isActive ? " active" : ""}`} aria-label={c.name}>
                <span className="category-chip__icon">
                  {imgUrl ? (
                    <img src={imgUrl} alt="" className="category-chip__img" loading="lazy" decoding="async" />
                  ) : (
                    <span className="category-chip__img-placeholder" />
                  )}
                </span>
                <span className="category-chip__label">{c.name.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  if (concerns.length === 0) return null;
  return (
    <div className="category-chip-strip category-chip-strip--concern" role="navigation" aria-label="Shop by concern">
      <div className="category-chip-strip__scroll">
        <Link to="/concerns" className={`category-chip${location.pathname === "/concerns" ? " active" : ""}`}>
          <span className="category-chip__icon all-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </span>
          <span className="category-chip__label">All</span>
        </Link>
        {concerns.map((c) => {
          const isActive = location.pathname === `/concern/${c.slug}`;
          const imgUrl = concernImageUrl(c);
          return (
            <Link key={c.id} to={`/concern/${c.slug}`} className={`category-chip${isActive ? " active" : ""}`} aria-label={c.name}>
              <span className="category-chip__icon">
                {imgUrl ? (
                  <img src={imgUrl} alt="" className="category-chip__img" loading="lazy" decoding="async" />
                ) : (
                  <span className="category-chip__img-placeholder concern-placeholder" />
                )}
              </span>
              <span className="category-chip__label">{c.name.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
