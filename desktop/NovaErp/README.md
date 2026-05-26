# NovaERP — Avalonia Apps

Cross-platform Avalonia 11.3 solution. The same `NovaErp` shared project is
referenced by all heads — same view models, same SQLite cache, same sync
worker, same Trust Blue Pay XAML resources.

## Solution

| Project                | Targets               | Notes |
| ---------------------- | --------------------- | ----- |
| `NovaErp/`             | net9.0                | Shared models, view models, services, views, styles. |
| `NovaErp.Desktop/`     | net9.0                | Windows / macOS / Linux desktop head. |
| `NovaErp.Android/`     | net9.0-android        | Android phone/tablet head. Uses `MobileMainView`. |
| `NovaErp.iOS/`         | net9.0-ios            | iOS head (scaffolded but not in the verified set). |
| `NovaErp.Browser/`     | net9.0-browser        | WebAssembly head (scaffolded). |

## Run desktop

```bash
dotnet run --project NovaErp.Desktop/NovaErp.Desktop.csproj
```

Set `NOVA_API` to point at a non-default backend (default
`http://localhost:4000`).

## Run Android

Requires the Android SDK + an emulator/device.

```bash
dotnet workload install android       # if not already installed
dotnet build  NovaErp.Android/NovaErp.Android.csproj
dotnet run    --project NovaErp.Android/NovaErp.Android.csproj
```

## Trust Blue Pay tokens

Defined in `NovaErp/Styles/TrustBluePay.axaml`. Includes:

* Color brushes: `PrimaryBrush`, `SecondaryBrush`, `SuccessBrush`,
  `WarningBrush`, `DangerBrush`, `Primary50Brush`, `CanvasBrush`,
  `SurfaceBrush`, `BorderBrush`, `InkBrush`, `InkMutedBrush`.
* Component classes: `Button.primary`, `Button.secondary`, `Button.gold`,
  `Button.danger`, `Button.ghost`, `Button.nav`, `Border.card`,
  `Border.chip{,.success,.warning,.danger,.primary}`, `TextBox.input`,
  `TextBox.scan`.
* Type classes: `TextBlock.h1`, `.h2`, `.h3`, `.amount`, `.caption`,
  `.muted`, `.mono`.

Mirrors the React/Tailwind tokens in `erp-portal/tailwind.config.js`.

## Local cache + sync

`Services/LocalCache.cs` opens a SQLite database at
`%LocalAppData%\NovaErp\novaerp.cache.db` (Windows) or the equivalent path
elsewhere. It stores `Product`, `ProductionOrder`, `Bin` projections plus an
`OutboxMutation` queue.

`Services/SyncService.cs` runs a background loop:
1. Drain outbox → `POST /v1/sync/push`.
2. Pull deltas → `GET /v1/sync/pull?since=…`.
3. Apply changes to the cache.

Outbox writes survive restarts (durable SQLite WAL); pushes are retried up
to 5 times with exponential surface error reporting in the bottom status
bar.

## Module screens

| Screen                   | View                                  |
| ------------------------ | ------------------------------------- |
| Login (password + PIN)   | `Views/LoginView.axaml`               |
| Desktop shell            | `Views/MainView.axaml`                |
| Mobile shell (Android)   | `Views/MobileMainView.axaml`          |
| Warehouse Station        | `Views/WarehouseStationView.axaml`    |
| Manufacturing Station    | `Views/ManufacturingStationView.axaml`|
| Dispatch Confirmation    | `Views/DispatchView.axaml`            |
| Worker Attendance        | `Views/AttendanceView.axaml`          |
