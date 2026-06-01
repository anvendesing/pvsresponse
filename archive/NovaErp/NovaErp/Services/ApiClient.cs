using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NovaErp.Models;

namespace NovaErp.Services;

public class ApiClient
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public string? Token { get; private set; }
    public AppUser? User { get; private set; }

    public ApiClient(HttpClient? http = null, string? baseUrl = null)
    {
        _http = http ?? new HttpClient();
        _http.BaseAddress = new Uri((baseUrl ?? AppSettings.ApiBaseUrl).TrimEnd('/'));
        _http.Timeout = TimeSpan.FromSeconds(30);
    }

    public bool IsAuthenticated => !string.IsNullOrEmpty(Token);

    public void SetToken(string? token, AppUser? user)
    {
        Token = token;
        User = user;
        _http.DefaultRequestHeaders.Authorization = string.IsNullOrEmpty(token)
            ? null
            : new AuthenticationHeaderValue("Bearer", token);
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage req, CancellationToken ct)
    {
        var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new HttpRequestException($"API {(int)res.StatusCode}: {body}");
        }
        var stream = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        return (await JsonSerializer.DeserializeAsync<T>(stream, Json, ct).ConfigureAwait(false))!;
    }

    private Task<T> GetAsync<T>(string path, CancellationToken ct = default)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, path);
        return SendAsync<T>(req, ct);
    }

    private Task<T> PostAsync<T>(string path, object body, CancellationToken ct = default)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body, options: Json),
        };
        return SendAsync<T>(req, ct);
    }

    public async Task<AuthResult> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var res = await PostAsync<AuthResult>("/v1/auth/login", new { username, password }, ct);
        SetToken(res.Token, res.User);
        return res;
    }

    public async Task<AuthResult> PinLoginAsync(string username, string pin, CancellationToken ct = default)
    {
        var res = await PostAsync<AuthResult>("/v1/auth/pin", new { username, pin }, ct);
        SetToken(res.Token, res.User);
        return res;
    }

    public Task<List<Product>> GetProductsAsync(string? q = null, CancellationToken ct = default)
        => GetAsync<List<Product>>($"/v1/products?limit=200{(string.IsNullOrEmpty(q) ? "" : $"&q={Uri.EscapeDataString(q)}")}", ct);

    public Task<Product?> GetProductByBarcodeAsync(string code, CancellationToken ct = default)
        => GetAsync<Product?>($"/v1/products/by-barcode/{Uri.EscapeDataString(code)}", ct);

    public Task<List<ProductionOrder>> GetProductionOrdersAsync(CancellationToken ct = default)
        => GetAsync<List<ProductionOrder>>("/v1/production-orders", ct);

    public Task<List<DispatchOrder>> GetDispatchesAsync(CancellationToken ct = default)
        => GetAsync<List<DispatchOrder>>("/v1/dispatches", ct);

    public Task<object> InventoryTransferAsync(
        string productId, double qty, string fromWh, string toWh,
        string? fromBin = null, string? toBin = null, string? reference = null,
        CancellationToken ct = default)
        => PostAsync<object>("/v1/inventory/transfer", new
        {
            productId,
            qty,
            fromWarehouseId = fromWh,
            toWarehouseId = toWh,
            fromBin,
            toBin,
            @ref = reference,
        }, ct);

    // ============== Sync ==============
    public Task<PullResponse> SyncPullAsync(string deviceId, string? since, int cursor, int limit, CancellationToken ct = default)
        => GetAsync<PullResponse>(
            $"/v1/sync/pull?deviceId={Uri.EscapeDataString(deviceId)}&cursor={cursor}&limit={limit}"
            + (string.IsNullOrEmpty(since) ? "" : $"&since={Uri.EscapeDataString(since)}"), ct);

    public Task<PushResponse> SyncPushAsync(string deviceId, IList<SyncMutation> mutations, CancellationToken ct = default)
        => PostAsync<PushResponse>("/v1/sync/push", new { deviceId, mutations }, ct);
}
