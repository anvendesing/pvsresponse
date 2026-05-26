# Trust Blue Pay

## Overview
Trust Blue Pay is a financial-grade design system built on deep blues and clean whites to convey security, reliability, and professionalism. Inspired by global payment platforms, it prioritizes clarity and trust through a blue-dominant palette, generous whitespace, and accessible typography. Every element communicates safety and ease of use.

## Colors
- **Primary** (#003087): Primary actions, branding, trust anchors — PayPal Navy
- **Primary Hover** (#00246B): Hovered buttons and active links
- **Secondary** (#009CDE): Secondary actions, informational highlights — PayPal Light Blue
- **Neutral** (#687173): Muted text, icons, placeholders — Slate Gray
- **Background** (#F5F7FA): Page background, form containers
- **Surface** (#FFFFFF): Cards, modals, payment panels
- **Text Primary** (#1A1A2E): Headings, body copy, transaction amounts
- **Text Secondary** (#687173): Labels, descriptions, helper text
- **Border** (#CBD2D6): Dividers, input outlines, card edges
- **Success** (#019C34): Successful transactions, payment confirmed
- **Warning** (#F5BA2E): Pending status, alerts, attention needed — PayPal Gold
- **Error** (#D20000): Failed transactions, validation errors, declined

## Typography
- **Display Font**: Inter — loaded from Google Fonts
- **Body Font**: Inter — loaded from Google Fonts
- **Code Font**: JetBrains Mono — loaded from Google Fonts

Inter provides excellent legibility for financial data and transaction details. Use weights 400 (body), 500 (labels), 600 (subheadings), and 700 (headings). Letter-spacing is -0.02em for display text, 0em for body. Line height is 1.5 for body, 1.25 for headings. Financial amounts should use tabular numerals (font-feature-settings: "tnum").

Type scale:
- Display: 40px / 700
- H1: 32px / 700
- H2: 24px / 600
- H3: 20px / 600
- Body: 16px / 400
- Body Small: 14px / 400
- Caption: 12px / 500
- Amount Large: 32px / 700, tabular nums
- Amount Small: 18px / 600, tabular nums

## Elevation
Elevation is used conservatively to maintain a clean, trustworthy appearance. Level 0 (flat) for inline content. Level 1 (`0 1px 4px rgba(0,48,135,0.06)`) for cards and panels. Level 2 (`0 4px 16px rgba(0,48,135,0.1)`) for dropdowns and popovers. Level 3 (`0 12px 32px rgba(0,48,135,0.14)`) for modals and payment confirmation dialogs. All shadows use the navy hue for tonal consistency.

## Components
- **Buttons**: 48px height, 24px horizontal padding, 8px border-radius, Inter 600 at 16px. Primary: #003087 bg, white text. Secondary: white bg, #003087 text, 2px #003087 border. Gold CTA: #F5BA2E bg, #1A1A2E text. Disabled: #CBD2D6 bg, #687173 text. Min-width 120px.
- **Cards**: White background, 1px #CBD2D6 border, 12px border-radius, 24px padding. Transaction cards: left border 4px colored by status (green/gold/red). Hover: Level 2 shadow.
- **Inputs**: 48px height, 16px horizontal padding, 8px border-radius, 1px #CBD2D6 border, white bg. Focus: 2px #003087 border. Error: 1px #D20000 border. Label above at 14px/500. Helper text below at 12px.
- **Chips**: 32px height, 12px horizontal padding, 9999px border-radius, #F5F7FA bg, #1A1A2E text at 14px. Status chips: Success #E6F4EA bg/#019C34 text, Pending #FFF8E1 bg/#F5BA2E text, Failed #FDE7E7 bg/#D20000 text.
- **Lists**: Transaction list rows 72px height, 16px padding, hover #F5F7FA bg. Amount right-aligned, tabular nums. Divider: 1px #CBD2D6. Clickable rows have cursor pointer and subtle bg transition.
- **Checkboxes**: 20px square, 4px border-radius, 1.5px #CBD2D6 border. Checked: #003087 bg, white checkmark. Focus ring: 3px offset, #009CDE at 30% opacity.
- **Tooltips**: #1A1A2E bg, white text at 13px, 6px border-radius, 8px 12px padding, max-width 240px. Arrow 6px.
- **Navigation**: Top bar 64px height, white bg, bottom 1px #CBD2D6 border. Logo left, nav links center (Inter 500, 15px, #1A1A2E, hover #003087 underline 2px). CTA button right.
- **Search**: 48px height, 16px padding, magnifying glass icon, 8px border-radius, #F5F7FA bg. Focus: white bg, 2px #003087 border. Autocomplete dropdown with Level 2 shadow.

## Spacing
- Base unit: 4px
- Scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96
- Component padding: Buttons 12px 24px, Cards 24px, Inputs 12px 16px
- Section spacing: 64px between major sections, 32px between subsections
- Container max width: 1120px, centered with 24px side padding
- Card grid gap: 24px

## Border Radius
- 4px: Small inline elements, checkboxes
- 8px: Buttons, inputs, chips inline
- 12px: Cards, panels, dropdowns
- 16px: Modals, full-width banners
- 9999px: Avatars, status dots, pill chips

## Do's and Don'ts
- Do use the dark navy (#003087) as the dominant brand color for trust
- Do use tabular numerals for all financial amounts and data
- Don't use bright or playful colors in transaction flows; keep it serious
- Do provide clear status indicators with color-coded chips (green/gold/red)
- Don't clutter payment forms; one action per screen when possible
- Do maintain generous padding in cards to give financial data room to breathe
- Don't use shadows heavier than Level 2 for non-modal elements
- Do ensure all text meets WCAG AA contrast ratios, especially on blue backgrounds
- Don't use the gold (#F5BA2E) for text on white backgrounds; it fails contrast