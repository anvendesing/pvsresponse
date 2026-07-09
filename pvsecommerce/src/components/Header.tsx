// Yellow brand header: announcement bar + logo + search + utilities,
// followed by the (desktop) primary nav. Search navigates to /search?q=...

import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import {
  CartIcon,
  HeartIcon,
  MenuIcon,
  SearchIcon,
  UserIcon,
} from "@/assets/icons";
import { useCart } from "@/state/CartContext";
import { useWishlist } from "@/state/WishlistContext";
import { useAuth } from "@/state/AuthContext";
import { useCatalog } from "@/state/CatalogContext";
import type { CatalogProduct } from "@/lib/api";

interface HeaderProps {
  onOpenMobileDrawer: () => void;
}

export const Header = ({ onOpenMobileDrawer }: HeaderProps) => {
  const cart = useCart();
  const wishlist = useWishlist();
  const auth = useAuth();
  const { products } = useCatalog();
  const [query, setQuery] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const concernNavActive =
    location.pathname === "/concerns" || location.pathname.startsWith("/concern/");

  // Compute suggestions whenever query changes
  const suggestions = useMemo<CatalogProduct[]>(() => {
    const q = query.trim();
    if (q.length < 3) return [];
    const needle = q.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.searchAliases ?? []).some((a) => a.toLowerCase().includes(needle))
      )
      .slice(0, 8);
  }, [query, products]);

  // Open dropdown when there are suggestions
  useEffect(() => {
    setDropOpen(suggestions.length > 0);
    setActiveIdx(-1);
  }, [suggestions]);

  // Close dropdown on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setDropOpen(false);
      setActiveIdx(-1);
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pickProduct(suggestions[activeIdx]);
    }
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setDropOpen(false);
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const pickProduct = (p: CatalogProduct) => {
    setQuery("");
    setDropOpen(false);
    navigate(`/product/${p.id}`);
  };

  // Highlight matching portion of text
  const highlight = (text: string, needle: string) => {
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + needle.length)}</mark>
        {text.slice(idx + needle.length)}
      </>
    );
  };

  return (
    <>
      <div className="announcement-bar">
        <span className="announcement-text">
          Free shipping on all orders above ₹3,000/-
        </span>
        <span className="announcement-socials">
          <a href="#" aria-label="Instagram">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z" />
              <path d="M17.5 6.5h.01" />
            </svg>
          </a>
          <a href="#" aria-label="Facebook">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z" />
            </svg>
          </a>
        </span>
      </div>

      <header className="header-main">
        <div className="header-row">
          <Link to="/" className="brand-link" aria-label="Prakruthivanam home">
            <img
              src="/brand/logo.png"
              alt="Prakruthivanam"
              className="brand-logo"
              loading="eager"
              decoding="async"
            />
          </Link>

          {/* Search with typeahead dropdown */}
          <div className="search-shell" ref={searchRef} style={{ position: "relative", overflow: "visible" }}>
            <form onSubmit={submitSearch} style={{ display: "contents" }}>
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder="Search products, herbs, remedies…"
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setDropOpen(true)}
                aria-label="Search products"
                aria-autocomplete="list"
                aria-expanded={dropOpen}
                aria-controls="search-suggestions"
                autoComplete="off"
              />
              <button className="search-trigger" type="submit" aria-label="Search">
                <SearchIcon />
              </button>
            </form>

            {dropOpen && suggestions.length > 0 && (
              <ul
                id="search-suggestions"
                className="search-dropdown"
                role="listbox"
                aria-label="Search suggestions"
              >
                {suggestions.map((p, i) => (
                  <li
                    key={p.id}
                    role="option"
                    aria-selected={i === activeIdx}
                    className={`search-dropdown__item${i === activeIdx ? " search-dropdown__item--active" : ""}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent input blur before click
                      pickProduct(p);
                    }}
                  >
                    {p.imageUrl && (
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="search-dropdown__thumb"
                        loading="lazy"
                      />
                    )}
                    <div className="search-dropdown__info">
                      <span className="search-dropdown__name">
                        {highlight(p.name, query.trim())}
                      </span>
                      <div className="search-dropdown__meta">
                        {p.category && (
                          <span className="search-dropdown__cat">{p.category}</span>
                        )}
                        {p.searchAliases && p.searchAliases.length > 0 && (
                          <span
                            className="search-dropdown__aliases"
                            title={p.searchAliases.join(" · ")}
                          >
                            {p.searchAliases.slice(0, 3).join(" · ")}
                            {p.searchAliases.length > 3 && (
                              <span className="search-dropdown__aliases-more">
                                {" "}+{p.searchAliases.length - 3} more
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <svg className="search-dropdown__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </li>
                ))}
                <li className="search-dropdown__footer" role="presentation">
                  <button
                    type="button"
                    className="search-dropdown__see-all"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDropOpen(false);
                      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                    }}
                  >
                    See all results for "<strong>{query.trim()}</strong>"
                  </button>
                </li>
              </ul>
            )}
          </div>

          <div className="header-utils">
            <button
              className="util-btn mobile-menu-btn"
              type="button"
              aria-label="Open menu"
              onClick={onOpenMobileDrawer}
            >
              <MenuIcon />
            </button>
            <Link
              to={auth.isAuthed ? "/account" : "/login"}
              className="util-btn"
              aria-label={auth.isAuthed ? "My account" : "Sign in"}
            >
              <UserIcon />
            </Link>
            <Link to="/account/wishlist" className="util-btn" aria-label="Wishlist">
              <HeartIcon />
              {wishlist.count > 0 && (
                <span className="util-badge">{wishlist.count}</span>
              )}
            </Link>
            <button
              type="button"
              className="util-btn"
              aria-label="Open cart"
              onClick={cart.openDrawer}
            >
              <CartIcon />
              {cart.count > 0 && (
                <span className="util-badge">{cart.count}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <nav className="nav-bar" aria-label="Primary navigation">
        <ul className="nav-links">
          <li>
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              Home
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/category/grains-pulses-flours"
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              Shop by Category
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/concerns"
              className={`nav-link ${concernNavActive ? "active" : ""}`}
            >
              Shop by Concern
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/bulk-order"
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              Bulk Order
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/contact"
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              Contact Us
            </NavLink>
          </li>
        </ul>
      </nav>
    </>
  );
};
