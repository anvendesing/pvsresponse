using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Data.Sqlite;
using NovaErp.Models;

namespace NovaErp.Services;

/// <summary>
/// Local SQLite cache (per-device). Stores core read-side projections so the
/// app can operate offline. The Sync worker keeps this in sync with the server.
/// </summary>
public class LocalCache
{
    private readonly string _connStr;

    public LocalCache(string? path = null)
    {
        var dbPath = path ?? AppSettings.LocalDbPath;
        _connStr = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true,
        }.ToString();

        EnsureSchema();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connStr);
        c.Open();
        return c;
    }

    private void EnsureSchema()
    {
        using var c = Open();
        c.Execute(@"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS Product (
  Id TEXT PRIMARY KEY,
  Sku TEXT NOT NULL UNIQUE,
  Name TEXT NOT NULL,
  Type TEXT NOT NULL,
  Uom TEXT NOT NULL,
  Barcode TEXT NOT NULL UNIQUE,
  State TEXT NOT NULL,
  Category TEXT NOT NULL,
  StockOnHand INTEGER NOT NULL DEFAULT 0,
  ReorderLevel INTEGER NOT NULL DEFAULT 0,
  CostPrice REAL NOT NULL DEFAULT 0,
  SellingPrice REAL NOT NULL DEFAULT 0,
  BatchTracked INTEGER NOT NULL DEFAULT 0,
  Version INTEGER NOT NULL DEFAULT 0,
  UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_product_barcode ON Product(Barcode);
CREATE INDEX IF NOT EXISTS idx_product_sku ON Product(Sku);

CREATE TABLE IF NOT EXISTS ProductionOrder (
  Id TEXT PRIMARY KEY,
  OrderNo TEXT NOT NULL UNIQUE,
  Station TEXT NOT NULL,
  PlannedQty REAL NOT NULL,
  ActualQty REAL NOT NULL DEFAULT 0,
  ScrapQty REAL NOT NULL DEFAULT 0,
  ReworkQty REAL NOT NULL DEFAULT 0,
  Status TEXT NOT NULL,
  StartDate TEXT NOT NULL,
  DueDate TEXT NOT NULL,
  Efficiency REAL NOT NULL DEFAULT 0,
  Version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Bin (
  Id TEXT PRIMARY KEY,
  WarehouseId TEXT NOT NULL,
  Zone TEXT NOT NULL,
  Rack TEXT NOT NULL,
  Shelf TEXT NOT NULL,
  BinCode TEXT NOT NULL,
  Capacity INTEGER NOT NULL DEFAULT 100,
  Occupied INTEGER NOT NULL DEFAULT 0,
  Qty INTEGER NOT NULL DEFAULT 0,
  ProductSku TEXT,
  ProductName TEXT,
  Batch TEXT,
  Version INTEGER NOT NULL DEFAULT 0
);

-- Outbound queue for offline writes pending push.
CREATE TABLE IF NOT EXISTS OutboxMutation (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Entity TEXT NOT NULL,
  EntityId TEXT NOT NULL,
  Op TEXT NOT NULL,
  BaseVersion INTEGER,
  Payload TEXT NOT NULL,
  ClientTime TEXT NOT NULL,
  Attempts INTEGER NOT NULL DEFAULT 0,
  LastError TEXT
);

-- Pull cursor / state.
CREATE TABLE IF NOT EXISTS SyncState (
  Id INTEGER PRIMARY KEY CHECK (Id = 1),
  LastPulledAt TEXT,
  Cursor INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO SyncState (Id) VALUES (1);
");
    }

    // ---------- Reads ----------
    public Task<IEnumerable<Product>> GetProductsAsync(string? q = null)
    {
        using var c = Open();
        if (string.IsNullOrEmpty(q))
            return Task.FromResult(c.Query<Product>("SELECT * FROM Product ORDER BY Sku LIMIT 500"));
        var like = $"%{q}%";
        return Task.FromResult(c.Query<Product>(@"
SELECT * FROM Product
WHERE Name LIKE @like OR Sku LIKE @like OR Barcode LIKE @like
ORDER BY Sku LIMIT 200", new { like }));
    }

    public Task<Product?> FindByBarcodeAsync(string code)
    {
        using var c = Open();
        return Task.FromResult(c.QueryFirstOrDefault<Product>(
            "SELECT * FROM Product WHERE Barcode = @code OR Sku = @code", new { code }));
    }

    public Task<IEnumerable<ProductionOrder>> GetProductionOrdersAsync()
    {
        using var c = Open();
        return Task.FromResult(c.Query<ProductionOrder>(
            "SELECT * FROM ProductionOrder ORDER BY StartDate DESC LIMIT 200"));
    }

    public Task<int> CountAsync(string table)
    {
        using var c = Open();
        return Task.FromResult(c.ExecuteScalar<int>($"SELECT COUNT(*) FROM {table}"));
    }

    // ---------- Writes (used by sync apply) ----------
    public void UpsertProduct(Product p, int version)
    {
        using var c = Open();
        c.Execute(@"
INSERT INTO Product (Id, Sku, Name, Type, Uom, Barcode, State, Category,
    StockOnHand, ReorderLevel, CostPrice, SellingPrice, BatchTracked, Version)
VALUES (@Id, @Sku, @Name, @Type, @Uom, @Barcode, @State, @Category,
    @StockOnHand, @ReorderLevel, @CostPrice, @SellingPrice, @BatchTracked, @Version)
ON CONFLICT(Id) DO UPDATE SET
    Sku=excluded.Sku, Name=excluded.Name, Type=excluded.Type, Uom=excluded.Uom,
    Barcode=excluded.Barcode, State=excluded.State, Category=excluded.Category,
    StockOnHand=excluded.StockOnHand, ReorderLevel=excluded.ReorderLevel,
    CostPrice=excluded.CostPrice, SellingPrice=excluded.SellingPrice,
    BatchTracked=excluded.BatchTracked, Version=excluded.Version,
    UpdatedAt=CURRENT_TIMESTAMP",
            new
            {
                p.Id, p.Sku, p.Name, p.Type, p.Uom, p.Barcode, p.State, p.Category,
                p.StockOnHand, p.ReorderLevel, p.CostPrice, p.SellingPrice,
                BatchTracked = p.BatchTracked ? 1 : 0,
                Version = version,
            });
    }

    public void DeleteRow(string table, string id)
    {
        using var c = Open();
        c.Execute($"DELETE FROM {table} WHERE Id = @id", new { id });
    }

    // ---------- Outbox ----------
    public void EnqueueMutation(SyncMutation m)
    {
        using var c = Open();
        c.Execute(@"
INSERT INTO OutboxMutation (Entity, EntityId, Op, BaseVersion, Payload, ClientTime)
VALUES (@Entity, @EntityId, @Op, @BaseVersion, @Payload, @ClientTime)",
            new
            {
                m.Entity, m.EntityId, m.Op, m.BaseVersion,
                Payload = System.Text.Json.JsonSerializer.Serialize(m.Payload),
                m.ClientTime,
            });
    }

    public IEnumerable<(long Id, SyncMutation Mutation, int Attempts)> DequeueMutations(int max = 100)
    {
        using var c = Open();
        var rows = c.Query("SELECT * FROM OutboxMutation ORDER BY Id ASC LIMIT @max", new { max });
        var list = new List<(long, SyncMutation, int)>();
        foreach (var r in rows)
        {
            var payloadDict = System.Text.Json.JsonSerializer
                .Deserialize<Dictionary<string, object?>>((string)r.Payload) ?? new();
            list.Add((
                (long)r.Id,
                new SyncMutation((string)r.Entity, (string)r.EntityId, (string)r.Op,
                    r.BaseVersion is null ? null : (int)(long)r.BaseVersion, payloadDict, (string)r.ClientTime),
                (int)(long)r.Attempts));
        }
        return list;
    }

    public void RemoveMutation(long id)
    {
        using var c = Open();
        c.Execute("DELETE FROM OutboxMutation WHERE Id = @id", new { id });
    }

    public void MarkMutationError(long id, string err)
    {
        using var c = Open();
        c.Execute(
            "UPDATE OutboxMutation SET Attempts = Attempts + 1, LastError = @err WHERE Id = @id",
            new { id, err });
    }

    public int OutboxCount()
    {
        using var c = Open();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM OutboxMutation");
    }

    // ---------- Sync state ----------
    public (string? LastPulledAt, int Cursor) GetSyncState()
    {
        using var c = Open();
        var row = c.QueryFirstOrDefault("SELECT LastPulledAt, Cursor FROM SyncState WHERE Id = 1");
        return (row?.LastPulledAt as string, row is null ? 0 : (int)(long)row.Cursor);
    }

    public void SetSyncState(string lastPulledAt, int cursor)
    {
        using var c = Open();
        c.Execute(
            "UPDATE SyncState SET LastPulledAt = @lastPulledAt, Cursor = @cursor WHERE Id = 1",
            new { lastPulledAt, cursor });
    }
}
