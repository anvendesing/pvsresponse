import { Link } from "react-router-dom";

export const Footer = () => (
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
          <li><Link to="/category/oils">Oils</Link></li>
          <li><Link to="/category/millets">Millets</Link></li>
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
