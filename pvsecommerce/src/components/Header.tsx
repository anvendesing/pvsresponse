// Yellow brand header: announcement bar + logo + search + utilities,
// followed by the (desktop) primary nav. Search submits a query that
// the home page uses to filter; for now it just navigates to /?q=...

import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
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

interface HeaderProps {
  onOpenMobileDrawer: () => void;
}

export const Header = ({ onOpenMobileDrawer }: HeaderProps) => {
  const cart = useCart();
  const wishlist = useWishlist();
  const auth = useAuth();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const concernNavActive =
    location.pathname === "/concerns" || location.pathname.startsWith("/concern/");

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
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

          <form className="search-shell" onSubmit={submitSearch}>
            <input
              type="text"
              className="search-input"
              placeholder="Search for products..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search products"
            />
            <button className="search-trigger" type="submit" aria-label="Search">
              <SearchIcon />
            </button>
          </form>

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
              All Products
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
            <a className="nav-link" href="mailto:hello@prakruthivanam.in">
              Contact Us
            </a>
          </li>
        </ul>
      </nav>
    </>
  );
};
