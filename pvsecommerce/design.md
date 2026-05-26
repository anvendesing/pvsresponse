# Design System & Specification: Prakruthivanam E-Commerce

This document establishes the design principles, visual identity, components, and behavioral guidelines for the **Prakruthivanam** e-commerce portal. The portal specializes in organic food products, millets, cold-pressed oils, and wellness goods, calling for a warm, natural, and premium look.

---

## 1. Brand Identity & Visual Language

Prakruthivanam (meaning "Nature's Forest" or "Natural Orchard") represents a commitment to chemical-free, traditional, and eco-conscious living. The visual theme is styled as **"Modern Organic Luxury"**:
- Warm, earthy color palettes inspired by fields of grains, golden millets, and lush green leaves.
- High-contrast, clean typography pairing elegant, timeless serif headings with geometric sans-serif body text.
- Rounded contours (large border-radii) and soft shadows to mimic nature's smooth edges and premium packaging.
- Subtle glassmorphism overlays for overlay elements (like the navigation or search dropdowns) to modernise the experience.

---

## 2. Color Palette (HSL & Hex)

We establish a coherent design system using custom CSS properties to ensure consistency.

```css
:root {
  /* Brand Primary & Accents */
  --primary-gold: #f0c238;       /* Prakruthivanam signature yellow */
  --primary-gold-dark: #dca31f;  /* Darker shade for active/hover states */
  --primary-gold-light: #fef3c7; /* Warm soft background yellow */
  
  --forest-green: #1e4620;       /* Rich eco-friendly green for CTA & accents */
  --forest-green-light: #2c652f; /* Hover states for green buttons */
  --forest-green-soft: #f0fdf4;  /* Super soft green backgrounds */

  /* Neutrals */
  --neutral-dark: #22251f;       /* Deep warm black/charcoal for text & footers */
  --neutral-gray: #78716c;       /* Muted stone grey for secondary text */
  --neutral-light: #fafaf9;      /* Off-white canvas background */
  --neutral-white: #ffffff;      /* Pure white for cards and floating bars */
  --neutral-cream: #fefaf0;      /* Slightly warm cream background for sections */

  /* Status Colors */
  --color-success: #15803d;      /* Green for positive feedback */
  --color-error: #b91c1c;        /* Red for alerts/errors */

  /* Shadows */
  --shadow-sm: 0 2px 4px rgba(34, 37, 31, 0.05);
  --shadow-md: 0 4px 12px rgba(34, 37, 31, 0.08);
  --shadow-lg: 0 10px 25px rgba(34, 37, 31, 0.12);
  
  /* Border Radius */
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-full: 9999px;
  
  /* Transitions */
  --transition-fast: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 3. Typography & Hierarchy

To give a handcrafted yet clean appearance:
- **Headings**: `Outfit` or `Playfair Display`, Sans-Serif / Serif. We will use **Outfit** as the primary font for clean geometric structure, and **Playfair Display** (or standard serif fallback) for custom, organic-feeling titles.
- **Body Text**: **Outfit** (Sans-Serif) for crisp, readable numbers, product weights, and descriptions.

| Token | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `h1` | `2.5rem` / `40px` | `700` (Bold) | `1.2` | Hero Section Titles |
| `h2` | `1.75rem` / `28px` | `600` (SemiBold) | `1.3` | Section Headers |
| `h3` | `1.25rem` / `20px` | `600` (SemiBold) | `1.4` | Product Cards, Modals |
| `body` | `1rem` / `16px` | `400` (Regular) | `1.5` | Descriptions, Paragraphs |
| `caption`| `0.875rem` / `14px` | `500` (Medium) | `1.4` | Badges, Secondary details |

---

## 4. Key Layout Components & Interfaces

### A. Global Yellow Header & Navigation
- **Announcement bar**: Olive green background (`#385f1c`), centered text: *"Free shipping on all orders above ₹3000/-"*, with outlined Instagram/Facebook SVGs on the right.
- **Header & Navigation Layers**: Unified mustard gold/yellow background (`#f0c238`) matching the nav bar.
- **Banyan Tree Logo**: Exquisitely drawn custom banyan tree SVG in green and brown, with Crimson Red trademarked text *"Prakruthivanam®"* and green tagline *"... for healthy living"*.
- **Search Bar**: White background container with straight corners, incorporating a square olive-green search trigger.
- **Utilities**: Solid black silhouette Profile icon, outline heart-plus Wishlist icon, and shopping cart outline.
- **Navigation links**: Spaced and centered links: All Products, Shop by Category, Shop by Concern, Combos, Contact Us.

### B. Interactive Hero Slider / Banner
- High-quality, earthy illustration showcasing "Healthy Millets".
- Clean typographic structure with a high-contrast dark green "Shop Now" call to action.
- Uses absolute-positioned grain vectors to enrich visual depth.

### C. Exact Category Grid (Rounded Cards with bottom pill badge)
- Grid layout displaying 10 exact categories (e.g. Oils, Flours, Millets, Sweets, Spices, Wellness, Household, Sweeteners, Utilities).
- Each category is a rounded white container (`border-radius: 20px`) with a thin boundary line, containing a soft-colored inner graphic panel and a floating white pill-shaped category title badge at the bottom.
- On hover, the category image container transitions dynamically (`scale(1.08)`) and the badge highlights with forest green boundaries.
- Clicking cards navigates the user directly to the split product page with smooth scrolling.

### D. Double-Column Splitting Layout with Equalized Card Heights
- Located in the mustard/gold section, presenting two separate grid layers side-by-side on desktop.
- Left Column: **Best Selling Products** (underlined green heading, presenting standard organic goods like Foxtail Millet Upma Mix).
- Right Column: **Combos** (underlined green heading, presenting bundle packages visualized as double colorful pouch layers).
- **Normalized Height Constraint**: All cards (Best Sellers and Combos alike) are strictly constrained to `440px` in CSS to enforce perfect horizontal alignment and prevent sizes from diverging.
- QTY Selector: Custom green `- QTY +` pill counter that adjusts the quantity in-cart.
- Add to Cart: Smooth sliding cart sidebar action when clicking the basket.

### E. Sliding Shopping Cart (Sidebar)
- Sliding panel appearing from the right side of the screen (`transform: translateX(100%)`).
- Uses a backdrop overlay (`rgba(0,0,0,0.5)`) to blur background content slightly.
- Displays items in cart, current subtotal, estimated shipping, and an interactive "Checkout" button.

### F. Dynamic Category Listing Page View (Next Page Simulation)
- Activated smoothly by clicking any category card in the Home View.
- **Left Sidebar (Filter Options)**:
  - Category menu link tree highlighting the selected category in bold green text.
  - Availability group containing interactive custom checkboxes for *In Stock* and *Out of Stocks* that instantly adjust the product listing.
- **Right Product Listing Grid**:
  - Dynamically renders 9 category-specific organic goods (e.g. various wood-pressed oils under Oils, different flour sacks under Grains, herbal products under Wellness, etc.).
  - Product Card matches screenshot details: top-right wishlist heart, small stock badge, bold card title, weight selectors, price label, yellow quantity selectors (`- 1 +`), and a solid yellow *"ADD TO CART"* button.
- **Pagination**: Centered circular buttons matching `< 1 2 3 ... 10 >` with the active page highlighted in golden yellow.

---

## 5. Micro-Animations & Dynamic States

All dynamic actions are animated to create a premium, living interface:
1. **Cart Slide-in**: `transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)` for an ultra-smooth gliding movement.
2. **Interactive Search**: The search input displays a soft glowing green focus ring and reveals a list of matched products immediately on keypress.
3. **Toast Notifications**: Slide up from the bottom-right corner, fading out after 3 seconds.
4. **Active Navigation Links**: Hovering over menu options triggers an organic underline expander (`transform: scaleX(1)` from center).
