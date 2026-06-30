import { useState } from "react";
import { Link } from "react-router-dom";

interface FooterProps {
  mobile?: boolean;
}

const sections = [
  {
    id: "shop",
    title: "Shop",
    links: [
      { to: "/", label: "All Products" },
      { to: "/category/oils-oil-seeds", label: "Oils" },
      { to: "/category/millets-millet-products", label: "Millets" },
      { to: "/category/wellness", label: "Wellness" },
    ],
  },
  {
    id: "account",
    title: "Account",
    links: [
      { to: "/account", label: "My Account" },
      { to: "/account/orders", label: "My Orders" },
      { to: "/account/wishlist", label: "My Wishlist" },
      { to: "/cart", label: "Cart" },
    ],
  },
  {
    id: "help",
    title: "Help",
    links: [
      { to: "/enquiry", label: "Bulk / Dealership Enquiry" },
      { to: "/track", label: "Track Order" },
      { href: "mailto:prakruthivanam@gmail.com", label: "Contact Us" },
      { href: "#", label: "Shipping Policy" },
      { href: "#", label: "Returns & Refunds" },
      { href: "#", label: "Privacy Policy" },
    ],
  },
] as const;

export const Footer = ({ mobile = false }: FooterProps) => {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpenSection((prev) => (prev === id ? null : id));

  if (mobile) {
    return (
      <footer className="site-footer site-footer--mobile">
        {/* Company info — always visible */}
        <div className="footer-mobile-brand">
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            className="footer-mobile-logo"
          />
          <p className="footer-mobile-desc">
            A working organic farm in Chinna Tippa Samudram, Andhra Pradesh.
            Chemical-free millets, cold-pressed oils, natural jaggery and
            handmade personal care.
          </p>
          <div className="footer-mobile-contact">
            <a href="tel:+919492903765">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>
              +91 94929 03765
            </a>
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Kothavaripalle, AP
            </span>
          </div>
        </div>

        {/* Accordion sections */}
        {sections.map(({ id, title, links }) => (
          <div key={id} className="footer-accordion">
            <button
              type="button"
              className={`footer-accordion__toggle${openSection === id ? " open" : ""}`}
              aria-expanded={openSection === id}
              onClick={() => toggle(id)}
            >
              {title}
              <svg
                className="footer-accordion__chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openSection === id && (
              <div className="footer-accordion__body">
                {links.map((l) =>
                  "to" in l ? (
                    <Link key={l.label} to={l.to} className="footer-accordion__link">
                      {l.label}
                    </Link>
                  ) : (
                    <a key={l.label} href={l.href} className="footer-accordion__link">
                      {l.label}
                    </a>
                  )
                )}
              </div>
            )}
          </div>
        ))}

        <div className="footer-bottom footer-bottom--mobile">
          © {new Date().getFullYear()} Prakruthivanam. All rights reserved.
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer">
      <div className="footer-row">
        <div className="footer-col">
          <div style={{ marginBottom: "0.85rem" }}>
            <img
              src="/brand/logo.png"
              alt="Prakruthivanam"
              style={{ height: 48, objectFit: "contain", display: "block" }}
            />
          </div>
          <p style={{ opacity: 0.78, fontSize: "0.88rem" }}>
            A working organic farm in Chinna Tippa Samudram, Andhra Pradesh.
            Chemical-free millets, cold-pressed oils, natural jaggery and
            handmade personal care — straight from our farm to your door.
          </p>
          <p style={{ marginTop: "0.65rem", opacity: 0.8, fontSize: "0.8rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z"/></svg>
              +91 94929 03765
            </span>
            <span>
              <svg width="11" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Kothavaripalle, AP
            </span>
          </p>
        </div>
        <div className="footer-col">
          <h4>Shop</h4>
          <ul>
            <li><Link to="/">All Products</Link></li>
            <li><Link to="/category/oils-oil-seeds">Oils</Link></li>
            <li><Link to="/category/millets-millet-products">Millets</Link></li>
            <li><Link to="/category/wellness">Wellness</Link></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Account</h4>
          <ul>
            <li><Link to="/account">My Account</Link></li>
            <li><Link to="/account/orders">My Orders</Link></li>
            <li><Link to="/account/wishlist">My Wishlist</Link></li>
            <li><Link to="/cart">Cart</Link></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Help</h4>
          <ul>
            <li><Link to="/enquiry">Bulk / Dealership Enquiry</Link></li>
            <li><Link to="/track">Track Order</Link></li>
            <li><a href="mailto:prakruthivanam@gmail.com">Contact Us</a></li>
            <li><a href="#">Shipping Policy</a></li>
            <li><a href="#">Returns &amp; Refunds</a></li>
            <li><a href="#">Privacy Policy</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} Prakruthivanam. All rights reserved.
      </div>
    </footer>
  );
};
