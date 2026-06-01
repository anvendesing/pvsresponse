using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NovaErp.Models;

namespace NovaErp.Services;

/// <summary>
/// Background sync worker. Periodically pulls deltas from the server and
/// pushes any locally queued mutations. Uses the device id stored under
/// AppSettings to identify itself, allowing the server to skip echoes.
/// </summary>
public class SyncService
{
    private readonly ApiClient _api;
    private readonly LocalCache _cache;
    private readonly string _deviceId;
    private CancellationTokenSource? _cts;

    public event Action<string>? StatusChanged;
    public event Action<int>? OutboxChanged;

    public DateTime? LastSync { get; private set; }
    public bool Running { get; private set; }
    public string LastStatus { get; private set; } = "idle";

    public SyncService(ApiClient api, LocalCache cache)
    {
        _api = api;
        _cache = cache;
        _deviceId = AppSettings.DeviceId;
    }

    public void Start(TimeSpan? interval = null)
    {
        if (Running) return;
        Running = true;
        _cts = new CancellationTokenSource();
        var period = interval ?? TimeSpan.FromSeconds(15);
        _ = Task.Run(async () =>
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                try
                {
                    await SyncOnceAsync(_cts.Token).ConfigureAwait(false);
                }
                catch (Exception e)
                {
                    LastStatus = $"error: {e.Message}";
                    StatusChanged?.Invoke(LastStatus);
                }
                try { await Task.Delay(period, _cts.Token).ConfigureAwait(false); }
                catch (TaskCanceledException) { break; }
            }
        });
    }

    public void Stop()
    {
        _cts?.Cancel();
        Running = false;
    }

    public async Task SyncOnceAsync(CancellationToken ct = default)
    {
        if (!_api.IsAuthenticated)
        {
            LastStatus = "not authenticated";
            StatusChanged?.Invoke(LastStatus);
            return;
        }

        LastStatus = "pushing";
        StatusChanged?.Invoke(LastStatus);
        await PushOutboxAsync(ct);

        LastStatus = "pulling";
        StatusChanged?.Invoke(LastStatus);
        await PullDeltasAsync(ct);

        LastSync = DateTime.UtcNow;
        LastStatus = "synced";
        StatusChanged?.Invoke(LastStatus);
        OutboxChanged?.Invoke(_cache.OutboxCount());
    }

    // ============== Push ==============
    private async Task PushOutboxAsync(CancellationToken ct)
    {
        var batch = new List<(long Id, SyncMutation Mutation)>();
        foreach (var (id, mut, attempts) in _cache.DequeueMutations(100))
        {
            if (attempts >= 5) continue; // dead-letter
            batch.Add((id, mut));
        }
        if (batch.Count == 0) return;

        try
        {
            var muts = new List<SyncMutation>(batch.Count);
            foreach (var b in batch) muts.Add(b.Mutation);
            var res = await _api.SyncPushAsync(_deviceId, muts, ct).ConfigureAwait(false);

            foreach (var b in batch) _cache.RemoveMutation(b.Id);

            // For conflicts we keep a record but don't retry (server-wins).
            foreach (var conflict in res.Conflicts)
            {
                LastStatus = $"conflict {conflict.Entity}/{conflict.EntityId} ({conflict.Reason})";
                StatusChanged?.Invoke(LastStatus);
            }
        }
        catch (Exception e)
        {
            foreach (var b in batch) _cache.MarkMutationError(b.Id, e.Message);
            throw;
        }
    }

    // ============== Pull ==============
    private async Task PullDeltasAsync(CancellationToken ct)
    {
        var (since, cursor) = _cache.GetSyncState();
        var res = await _api.SyncPullAsync(_deviceId, since, cursor, 500, ct).ConfigureAwait(false);
        foreach (var change in res.Changes) ApplyChange(change);
        _cache.SetSyncState(res.ServerTime, res.NextCursor);
    }

    private void ApplyChange(PullChange change)
    {
        switch (change.Entity)
        {
            case "Product":
                if (change.Op == "delete") _cache.DeleteRow("Product", change.EntityId);
                else
                {
                    var p = JsonSerializer.Deserialize<Product>(
                        JsonSerializer.Serialize(change.Payload),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (p is not null) _cache.UpsertProduct(p, change.Version);
                }
                break;
            // Additional entity routers can be added here as the desktop view set grows.
            default:
                // Unknown entity — skipped.
                break;
        }
    }

    // ============== Public mutation entry-points ==============

    /// <summary>Records a fast-transfer locally, queues for push, applies to local cache.</summary>
    public void EnqueueTransfer(string productId, double qty,
        string fromWh, string fromBin, string toWh, string toBin)
    {
        var payload = new Dictionary<string, object?>
        {
            ["productId"] = productId,
            ["qty"] = qty,
            ["fromWarehouseId"] = fromWh,
            ["fromBin"] = fromBin,
            ["toWarehouseId"] = toWh,
            ["toBin"] = toBin,
            ["txnType"] = "Transfer",
        };
        // Use a "synthetic" client-generated id so the server can dedupe on retry.
        _cache.EnqueueMutation(new SyncMutation(
            "StockLedger",
            "client-" + Guid.NewGuid().ToString("N")[..16],
            "insert",
            null,
            payload,
            DateTime.UtcNow.ToString("o")));
        OutboxChanged?.Invoke(_cache.OutboxCount());
    }
}
