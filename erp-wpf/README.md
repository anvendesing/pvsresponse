# NovaERP Sales Desk (WPF)

Keyboard-first desktop client for **quotes → sales orders → pick → pack**, plus **customer search, creation, AR statement, and payment history**. Uses the same `/v1` API and Trust Blue visual style as the ERP portal.

## Requirements

- .NET 8 SDK (Windows)
- Backend running at `http://localhost:4000` (see repo `backend/`)

## Run

```powershell
cd backend
npm run dev

# separate terminal
cd erp-wpf/NovaErp.SalesDesk
dotnet run
```

Configure API URL in `appsettings.json`:

```json
{ "ApiBaseUrl": "http://localhost:4000/v1" }
```

Default login (seed data): `arjun.patel` / `nova1234` (billing or supervisor role).

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+1–5** | Quotes / Sales orders / Pick / Pack / Customers |
| **Ctrl+N** | New quote |
| **Ctrl+S** | Save quote |
| **Ctrl+K** | Customer search (quote editor) |
| **F3** | Product search (quote editor) |
| **Ctrl+Enter** | Submit quote |
| **Convert button** | Accept quote → sales order |
| **F5** | Refresh current list |
| **Esc** | Back to list |
| **Enter** | Open selected row / add line |
| **F10** | Complete pick list / pack slip |
| **Double-click** | Open quote / pick / pack row |

## Modules

- **Quotes** — create, edit lines with price-list resolution, submit, convert to SO (handles credit-hold 202)
- **Sales orders** — list, create pick list from SO
- **Pick lists** — enter picked qty per bin line, complete → auto-creates packing slip
- **Packing slips** — confirm packed qty, pack & invoice
- **Customers** — instant filter search, create customer, AR statement ledger, payment history

## Project layout

```
erp-wpf/
  NovaErp.SalesDesk.sln
  NovaErp.SalesDesk/
    Services/ApiClient.cs    # HTTP client mirroring erp-portal/src/lib/api.ts
    ViewModels/              # MVVM (CommunityToolkit.Mvvm)
    Views/                   # WPF XAML screens
    Themes/ErpTheme.xaml     # #003087 primary, canvas/surface tokens
```

## Build release

```powershell
dotnet publish -c Release -r win-x64 --self-contained false
```

Output: `bin/Release/net8.0-windows/win-x64/publish/`
