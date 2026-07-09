// Mobile slide-in navigation drawer.
// Opens from left; backdrop closes it. Escape also closes it.
// "Shop by Category" and "Shop by Concern" are accordions —
// only one accordion can be open at a time.

import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { CloseIcon } from "@/assets/icons";
import { useCategories } from "@/state/CategoriesContext";
import { useConcerns } from "@/state/ConcernsContext";
import { useAuth } from "@/state/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Accordion = "category" | "concern" | null;

export const MobileDrawer = ({ open, onClose }: Props) => {
  const { categories } = useCategories();
  const { concerns } = useConcerns();
  const auth = useAuth();
  const [expanded, setExpanded] = useState<Accordion>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // Focus trap & scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Collapse accordions when drawer closes
  useEffect(() => {
    if (!open) setExpanded(null);
  }, [open]);

  const toggle = (id: Accordion) =>
    setExpanded((prev) => (prev === id ? null : id));

  const navClose = () => onClose();

  return (
    <>
      {/* Backdrop */}
      <div
        className={`drawer-backdrop${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`mobile-drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="mobile-drawer__header">
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            className="mobile-drawer__logo"
          />
          <button
            ref={firstFocusRef}
            type="button"
            className="mobile-drawer__close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Nav items */}
        <nav className="mobile-drawer__nav" aria-label="Site navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            onClick={navClose}
          >
            Home
          </NavLink>

          {/* Shop by Category accordion */}
          <div className="drawer-accordion">
            <button
              type="button"
              className={`drawer-accordion__toggle${expanded === "category" ? " open" : ""}`}
              aria-expanded={expanded === "category"}
              onClick={() => toggle("category")}
            >
              Shop by Category
              <svg
                className="drawer-accordion__chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {expanded === "category" && (
              <div className="drawer-accordion__body">
                {categories.map((c) => (
                  <NavLink
                    key={c.id}
                    to={`/category/${c.slug}`}
                    className={({ isActive }) => `drawer-sub-link${isActive ? " active" : ""}`}
                    onClick={navClose}
                  >
                    {c.name}
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          {/* Shop by Concern accordion */}
          <div className="drawer-accordion">
            <button
              type="button"
              className={`drawer-accordion__toggle${expanded === "concern" ? " open" : ""}`}
              aria-expanded={expanded === "concern"}
              onClick={() => toggle("concern")}
            >
              Shop by Concern
              <svg
                className="drawer-accordion__chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {expanded === "concern" && (
              <div className="drawer-accordion__body">
                {concerns.map((c) => (
                  <NavLink
                    key={c.id}
                    to={`/concern/${c.slug}`}
                    className={({ isActive }) => `drawer-sub-link${isActive ? " active" : ""}`}
                    onClick={navClose}
                  >
                    {c.name}
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          <NavLink
            to="/bulk-order"
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            onClick={navClose}
          >
            Bulk Order
          </NavLink>

          <NavLink
            to="/contact"
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            onClick={navClose}
          >
            Contact Us
          </NavLink>

          <div className="drawer-divider" role="separator" />

          <NavLink
            to={auth.isAuthed ? "/account" : "/login"}
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            onClick={navClose}
          >
            {auth.isAuthed ? "My Account" : "Sign In"}
          </NavLink>

          {auth.isAuthed && (
            <NavLink
              to="/account/orders"
              className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
              onClick={navClose}
            >
              My Orders
            </NavLink>
          )}

          <NavLink
            to="/track"
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            onClick={navClose}
          >
            Track Order
          </NavLink>
        </nav>
      </aside>
    </>
  );
};
