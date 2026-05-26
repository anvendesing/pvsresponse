import { Link } from "react-router-dom";

export const Footer = () => (
  <footer className="site-footer">
    <div className="footer-row">
      <div className="footer-col">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8, flexShrink: 0 }}
          />
          <h4 style={{ marginBottom: 0 }}>Prakruthivanam</h4>
        </div>
        <p style={{ opacity: 0.78, fontSize: "0.88rem" }}>
          A working organic farm in Chinna Tippa Samudram, Andhra Pradesh.
          Chemical-free millets, cold-pressed oils, natural jaggery and
          handmade personal care — straight from our farm to your door.
        </p>
        <p style={{ marginTop: "0.65rem", opacity: 0.65, fontSize: "0.8rem" }}>
          📞 +91 94929 03765 &nbsp;·&nbsp; 📍 Kothavaripalle, AP
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
