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
  const { categories } = useCategories();
  const { concerns } = useConcerns();
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
            All
          </Link>
      {categories.map((c) => {
            const isActive = location.pathname === `/category/${c.slug}`;
            return (
              <Link key={c.id} to={`/category/${c.slug}`} className={`category-chip${isActive ? " active" : ""}`} aria-label={c.name}>
                {c.name}
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
          All
        </Link>
        {concerns.map((c) => {
          const isActive = location.pathname === `/concern/${c.slug}`;
          return (
            <Link key={c.id} to={`/concern/${c.slug}`} className={`category-chip${isActive ? " active" : ""}`} aria-label={c.name}>
              {c.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
};
