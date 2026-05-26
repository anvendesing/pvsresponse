# PvsCommerce Mobile — Plan

## Goal
Native-feeling Android e-commerce app for Prakruthivanam built with Avalonia UI 12, sharing a code path with a future WPF (Desktop) launch. Visual parity with the React `pvsecommerce` storefront, fully driven by the existing `/v1/storefront-mock/*` API.

## How to run

### Desktop (developer loop today)
```powershell
# Terminal 1 - backend
cd d:\coding\pvsresponse\backend
npm run dev

# Terminal 2 - app
cd d:\coding\pvsresponse\mobile
dotnet run --project PvsCommerce.Mobile.Desktop
```

### Android (after SDK install)
The .NET Android *workload* is installed (`dotnet workload list` shows
`android 35.0.78/9.0.100`), but Android *SDK* + emulator are a separate
install. One-time setup:
1. Install Android Studio (or the standalone "Android Command Line Tools")
   from https://developer.android.com/studio
2. From Android Studio's SDK Manager install:
   - Android SDK Platform 35
   - Android SDK Build-Tools 35.0.0
   - Android SDK Platform-Tools
   - One x86_64 emulator system image (e.g. Android 15 default)
3. Set `ANDROID_HOME` env var to the SDK path (typically
   `%LOCALAPPDATA%\Android\Sdk`).
4. Restart the shell, then:
   ```powershell
   cd d:\coding\pvsresponse\mobile
   dotnet build PvsCommerce.Mobile.Android
   # Deploy to a connected device / running emulator:
   dotnet build PvsCommerce.Mobile.Android -t:Run
   ```

## Decisions locked
| Topic | Choice | Why |
|-------|--------|-----|
| Heads | Android + Desktop only (iOS / Browser deleted) | Lean, ships APK fast; Desktop ready for WPF launch |
| Avalonia version | 12.0.3 (template default) | SkiaSharp 3 default → 16 KB Android page compliance built-in |
| MVVM toolkit | CommunityToolkit.Mvvm | Source-generators, AOT-friendly, smaller APK than ReactiveUI |
| Compiled bindings | enabled | Catches XAML errors at build time, faster runtime |
| ViewLocator | removed (`-rvl`) | trim/AOT friendly; we use explicit view registry |
| Auth | dummy email-only (mirrors React `AuthContext`) | matches existing storefront UX |
| Image strategy | hybrid: bundled vector packaging-art + optional `imageUrl` | works without product photos; upgrades when photos arrive |
| Image hosting | local FS at `backend/uploads/products` via `@fastify/static` | fits IP-only VPS deploy |
| Image loading lib | `AsyncImageLoader.Avalonia` (DiskCachedWebImageLoader) | RAM + disk LRU cache, async, Android-aware path |
| HTTP client | `HttpClient` + `System.Text.Json` (source-generated context) | AOT-friendly, no Newtonsoft |
| State | services registered via `Microsoft.Extensions.DependencyInjection` | mirrors backend pattern, easy to test |
| Persistence | `ApplicationData.Current.LocalFolder` for cart/wishlist JSON | no SQLite needed yet; upgrade later if required |

## Project shape
```
mobile/
├── PvsCommerce.Mobile.sln
├── Directory.Packages.props              # central package versions
├── PvsCommerce.Mobile/                   # shared Avalonia UI library
│   ├── Assets/                           # avares://-served images, fonts
│   ├── Models/                           # CatalogProduct, CartLine, ApiResult
│   ├── Services/                         # ApiClient, CatalogService, CartService, AppConfig, NavigationService
│   ├── Styles/                           # Tokens.axaml, Typography.axaml, Buttons.axaml, Cards.axaml
│   ├── ViewModels/                       # one per page + shell
│   ├── Views/                            # AXAML views
│   ├── App.axaml(.cs)
│   └── PvsCommerce.Mobile.csproj
├── PvsCommerce.Mobile.Android/
│   ├── MainActivity.cs
│   ├── Properties/AndroidManifest.xml
│   └── PvsCommerce.Mobile.Android.csproj
└── PvsCommerce.Mobile.Desktop/
    └── PvsCommerce.Mobile.Desktop.csproj  # WPF-launch host
```

## Theme mapping (CSS → AXAML)
React `theme.css` design tokens map 1:1 into a single `Styles/Tokens.axaml` resource dictionary so the brand stays in sync:

| CSS variable | AXAML resource |
|---|---|
| `--primary-gold` `#f0c238` | `{StaticResource BrandGold}` |
| `--forest-green` `#385f1c` | `{StaticResource BrandForest}` |
| `--neutral-cream` `#fdfaf2` | `{StaticResource BrandCream}` |
| `--radius-md` `16px` | `<CornerRadius x:Key="RadiusMd">16</CornerRadius>` |
| `--shadow-md` | `<BoxShadows x:Key="ShadowMd">…</BoxShadows>` |

Fonts: bundle Lato (body) and Playfair Display (display) under `Assets/Fonts/`, expose via `FontFamily="avares://PvsCommerce.Mobile/Assets/Fonts#Lato"` etc. `App.axaml` registers Inter as a final fallback (template default).

## Image storage strategy

### Phase A — vector-only (today)
* Port `pvsecommerce/src/components/PackagingArt.tsx` SVGs to Avalonia `DrawingImage` resources keyed by packaging hint (`craft-bag`, `bottle-oil`, `soap-pack`, `combo-bags`).
* Helpers: `PackagingHint.From(productName)` mirrors the React `packagingFromName` heuristic.
* Zero network cost — works offline first-launch.

### Phase B — hybrid (target)
* Backend: extend `Product` schema with `imageUrl String?` (already have `imageHint`).
* Backend: serve `backend/uploads/products/*.{jpg,webp}` via `@fastify/static` plugin under `/uploads/products/`.
* Backend: include `imageUrl` in `/v1/storefront-mock/catalog` and `/v1/storefront-mock/products/:id` responses (absolute URL or relative-to-base — app composes with `AppConfig.ApiBaseUrl`).
* App: `AsyncImageLoader.Avalonia` with `DiskCachedWebImageLoader` writing to `Path.Combine(AppContext.BaseDirectory, "image-cache")` on Desktop and `Application.Context.CacheDir.AbsolutePath + "/images"` on Android.
* `<Image asyncImageLoader:ImageLoader.Source="{Binding ImageUrl}" />` with the vector resource bound as `FallbackContent`.
* Cache eviction: LRU 64 MB ceiling, sweep on app start.

### Phase C — admin upload (later)
* New ERP page “Product photos” (drag-drop into `Products` editor) that POSTs to `/v1/admin/products/:id/image`.
* Backend writes to `uploads/products/<sku>.jpg` and updates `Product.imageUrl`.
* Optional: image variants (`sku-thumb.webp`, `sku-card.webp`, `sku-detail.webp`) generated server-side via `sharp`.

## API integration

| Endpoint (existing) | Used by |
|---|---|
| `GET /v1/storefront-mock/catalog` | HomeViewModel, CategoryViewModel |
| `GET /v1/storefront-mock/products/:id` | ProductDetailViewModel |
| `POST /v1/storefront-mock/order` | CheckoutViewModel |
| `GET /v1/storefront-mock/orders?email=` | AccountOrdersViewModel |

`ApiClient` is a thin wrapper around `HttpClient` with a typed `GetAsync<T>()` and `PostAsync<TReq,TRes>()`, both using a `JsonSerializerContext` so it stays trim-safe.

`AppConfig.ApiBaseUrl` defaults:
* Android Debug → `http://10.0.2.2:4000/v1` (loopback to host machine)
* Android Release → injected via `app.config.json` AvaloniaResource at build
* Desktop → `http://localhost:4000/v1`

`AndroidManifest.xml` gets `usesCleartextTraffic="true"` for dev only (will tighten with a `network_security_config.xml` before Play Store submission).

## Navigation
Avalonia has no built-in shell navigator. We register a tiny `INavigationService` exposing:
```csharp
Navigate<TViewModel>(object? param = null);
GoBack();
ICommand BackCommand { get; }
ObservableCollection<object> Stack { get; }   // back-stack
```
`MainView` hosts a `<ContentControl Content="{Binding CurrentView}">` plus a sticky bottom-nav for Home/Search/Cart/Account on phone; on Desktop the nav lives in a left rail.

## State containers
| Service | Persistence | Notes |
|---|---|---|
| `AuthService` | `Preferences` (KV file in LocalFolder) | dummy email/name; matches React |
| `CartService` | `cart.json` | `ObservableCollection<CartLine>` + `Subtotal`/`ItemCount` derived |
| `WishlistService` | `wishlist.json` | `HashSet<string>` of variant/product ids |
| `CatalogService` | none (RAM) | one fetch on shell start, refresh-pull supported later |
| `ToastService` | none | exposed via `MainViewModel.Toasts` |

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation (this turn) | Solution, theme tokens, fonts, API client, models, HomeView with hero + product grid loaded from live backend, backend `imageUrl` plumbing, builds clean on Desktop head | **done** |
| 2 — Browse + cart | CategoryView, ProductDetailView, CartView, CheckoutView, navigation service, persisted cart/wishlist | next |
| 3 — Account | LoginView, AccountOverview, AccountOrders, AccountWishlist | next |
| 4 — Polish | Pull-to-refresh, skeleton loading, toast pattern, gesture polish, splash icon | next |
| 5 — Ship | AOT/trim config, Skia 3 enabled (default in 12), 16 KB validation, signing, APK + AAB build, network_security_config tightening | next |
| 6 — Desktop launch | WPF-style window chrome, multi-column layout breakpoints, installer | later |
| 7 — Admin photos | ERP page to upload product photos; image variants | later |

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Android emulator can't reach host backend | `10.0.2.2` loopback in Debug; documented in README |
| Trimming breaks JSON deserialization | Use `JsonSerializerContext` (System.Text.Json source generator) |
| Desktop dev loop slow due to Skia compile | Use `dotnet watch run --project PvsCommerce.Mobile.Desktop` |
| Local images bloat APK | Vector packaging art is `<10 KB`; raster product images deferred to Phase B |
| Future WPF requires touch-first layouts revisited | Keep all sizes in `<x:Double>` resources; bind to `WindowSize` for breakpoints |
