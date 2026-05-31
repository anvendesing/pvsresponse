# NovaERP Feature Brochure

Generates **NovaERP-Features.pdf** — a print-ready A4 feature document with live ERP screenshots.

## Outputs

| File | Description |
|------|-------------|
| `brochure.html` | Source HTML (A4 pages, embedded screenshots) |
| `screenshots/*.png` | Captured from running ERP portal |
| `NovaERP-Features.pdf` | Final PDF (also copied to repo root) |
| `../erp-portal/public/brochure/` | Preview at http://localhost:5173/brochure/index.html |

## Regenerate (full pipeline)

1. Start dev servers:
   - `npm run dev` in `backend/` (port 4000)
   - `npm run dev` in `erp-portal/` (port 5173)

2. From this folder:

```bash
npm install
npx playwright install chromium   # first time only
npm run build                     # screenshots + PDF
```

Or step by step:

```bash
npm run screenshots
npm run pdf
npm run sync-public
```

**Login used for captures:** `admin` / `nova1234` (seed user).

**PDF engine:** Microsoft Edge headless (`build-pdf.ps1`). Chrome works with the same flags if Edge is unavailable.

## Customize

- `ERP_URL` / `API_URL` env vars override defaults in `capture-screenshots.mjs`
- Edit `brochure.html` for copy/layout; re-run `npm run pdf` only if screenshots are unchanged
