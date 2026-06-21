using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using NovaErp.SalesDesk.Models;

namespace NovaErp.SalesDesk.Services;

public sealed class ApiException : Exception
{
    public int StatusCode { get; }
    public ApiException(int statusCode, string message) : base(message) => StatusCode = statusCode;
}

public sealed class AppSession
{
    public string? Token { get; private set; }
    public ApiUser? User { get; private set; }
    public bool IsAuthenticated => !string.IsNullOrEmpty(Token);

    public void Set(string token, ApiUser user)
    {
        Token = token;
        User = user;
    }

    public void Clear()
    {
        Token = null;
        User = null;
    }
}

public sealed class ApiClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly HttpClient _http;
    private readonly AppSession _session;

    public ApiClient(IConfiguration config, AppSession session)
    {
        _session = session;
        var baseUrl = config["ApiBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4000/v1";
        _http = new HttpClient { BaseAddress = new Uri(baseUrl + "/") };
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public async Task<bool> HealthCheckAsync(CancellationToken ct = default)
    {
        try
        {
            var root = _http.BaseAddress!.ToString().Replace("/v1/", "/").TrimEnd('/');
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var res = await client.GetAsync($"{root}/health", ct);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public async Task<AuthResponse> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var res = await PostAsync<AuthResponse>("/auth/login", new { username, password }, auth: false, ct);
        _session.Set(res.Token, res.User);
        return res;
    }

    public void Logout() => _session.Clear();

    // ── Customers ────────────────────────────────────────────────────────
    public Task<List<CustomerRow>> GetCustomersAsync(CancellationToken ct = default) =>
        GetAsync<List<CustomerRow>>("/customers", ct);

    public Task<CustomerRow> GetCustomerAsync(string id, CancellationToken ct = default) =>
        GetAsync<CustomerRow>($"/customers/{id}", ct);

    public Task<CustomerRow> CreateCustomerAsync(CustomerInput body, CancellationToken ct = default) =>
        PostAsync<CustomerRow>("/customers", body, ct: ct);

    public Task<CustomerStatement> GetCustomerStatementAsync(string id, CancellationToken ct = default) =>
        GetAsync<CustomerStatement>($"/customers/{id}/statement", ct);

    public Task<List<CustomerPayment>> GetCustomerPaymentsAsync(string customerId, CancellationToken ct = default) =>
        GetAsync<List<CustomerPayment>>("/customer-payments", ct, ("customerId", customerId));

    // ── Products ─────────────────────────────────────────────────────────
    public Task<List<Product>> SearchProductsAsync(string q, int limit = 30, CancellationToken ct = default) =>
        GetAsync<List<Product>>("/products", ct,
            ("q", q),
            ("limit", limit.ToString()));

    public Task<List<Product>> GetProductsAsync(int limit = 500, CancellationToken ct = default) =>
        GetAsync<List<Product>>("/products", ct, ("limit", limit.ToString()));

    public Task<ResolvedPrice> ResolvePriceAsync(string productId, string? variantId, string? customerId, decimal qty, CancellationToken ct = default) =>
        GetAsync<ResolvedPrice>("/pricing/resolve", ct,
            ("productId", productId),
            ("variantId", variantId ?? ""),
            ("customerId", customerId ?? ""),
            ("qty", qty.ToString()));

    // ── Quotes ───────────────────────────────────────────────────────────
    public Task<List<QuoteRow>> GetQuotesAsync(string? q = null, string? status = null, CancellationToken ct = default) =>
        GetAsync<List<QuoteRow>>("/quotes", ct,
            ("q", q ?? ""),
            ("status", status ?? ""),
            ("limit", "100"));

    public Task<QuoteRow> GetQuoteAsync(string id, CancellationToken ct = default) =>
        GetAsync<QuoteRow>($"/quotes/{id}", ct);

    public Task<QuoteRow> CreateQuoteAsync(QuoteCreatePayload body, CancellationToken ct = default) =>
        PostAsync<QuoteRow>("/quotes", body, ct: ct);

    public Task<QuoteRow> UpdateQuoteAsync(string id, QuoteCreatePayload body, CancellationToken ct = default) =>
        PatchAsync<QuoteRow>($"/quotes/{id}", body, ct);

    public Task<QuoteRow> SubmitQuoteAsync(string id, CancellationToken ct = default) =>
        PostAsync<QuoteRow>($"/quotes/{id}/submit", new { }, ct: ct);

    public async Task<AcceptQuoteResponse> AcceptQuoteAsync(string id, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"quotes/{id}/accept")
        {
            Content = JsonContent.Create(new { }, options: JsonOpts),
        };
        ApplyAuth(req);
        using var res = await _http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Accepted)
        {
            using var doc = JsonDocument.Parse(text);
            return new AcceptQuoteResponse
            {
                CreditHold = true,
                Message = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : "Credit limit approval required.",
            };
        }
        await EnsureSuccessAsync(res);
        // 200 may be SalesOrder directly or wrapper
        using var ok = JsonDocument.Parse(text);
        if (ok.RootElement.TryGetProperty("creditHold", out _))
        {
            return new AcceptQuoteResponse { CreditHold = true, Message = "Credit hold" };
        }
        if (ok.RootElement.TryGetProperty("alreadyConverted", out var ac) && ac.GetBoolean())
        {
            var so = JsonSerializer.Deserialize<SalesOrderRow>(ok.RootElement.GetProperty("salesOrder").GetRawText(), JsonOpts);
            return new AcceptQuoteResponse { AlreadyConverted = true, SalesOrder = so };
        }
        if (ok.RootElement.TryGetProperty("soNo", out _))
        {
            var so = JsonSerializer.Deserialize<SalesOrderRow>(text, JsonOpts);
            return new AcceptQuoteResponse { SalesOrder = so };
        }
        var parsed = JsonSerializer.Deserialize<AcceptQuoteResponse>(text, JsonOpts);
        return parsed ?? new AcceptQuoteResponse();
    }

    public Task DeleteQuoteAsync(string id, CancellationToken ct = default) =>
        DeleteAsync($"/quotes/{id}", ct);

    // ── Sales orders ─────────────────────────────────────────────────────
    public Task<List<SalesOrderRow>> GetSalesOrdersAsync(string? q = null, CancellationToken ct = default) =>
        GetAsync<List<SalesOrderRow>>("/sales-orders", ct, ("q", q ?? ""), ("limit", "100"));

    public Task<SalesOrderRow> GetSalesOrderAsync(string id, CancellationToken ct = default) =>
        GetAsync<SalesOrderRow>($"/sales-orders/{id}", ct);

    public Task<PickListRow> CreatePickListAsync(string salesOrderId, CancellationToken ct = default) =>
        PostAsync<PickListRow>($"/sales-orders/{salesOrderId}/pick-lists", new { }, ct: ct);

    // ── Pick lists ───────────────────────────────────────────────────────
    public Task<List<PickListRow>> GetPickListsAsync(string? status = null, CancellationToken ct = default) =>
        GetAsync<List<PickListRow>>("/pick-lists", ct, ("status", status ?? ""), ("limit", "100"));

    public Task<PickListRow> GetPickListAsync(string id, CancellationToken ct = default) =>
        GetAsync<PickListRow>($"/pick-lists/{id}", ct);

    public Task<PickListRow> UpdatePickListAsync(string id, object body, CancellationToken ct = default) =>
        PatchAsync<PickListRow>($"/pick-lists/{id}", body, ct);

    public Task<CompletePickResponse> CompletePickListAsync(string id, CancellationToken ct = default) =>
        PostAsync<CompletePickResponse>($"/pick-lists/{id}/complete", new { }, ct: ct);

    // ── Packing slips ────────────────────────────────────────────────────
    public Task<List<PackingSlipRow>> GetPackingSlipsAsync(string? status = null, CancellationToken ct = default) =>
        GetAsync<List<PackingSlipRow>>("/packing-slips", ct, ("status", status ?? ""), ("limit", "100"));

    public Task<PackingSlipRow> GetPackingSlipAsync(string id, CancellationToken ct = default) =>
        GetAsync<PackingSlipRow>($"/packing-slips/{id}", ct);

    public Task<PackingSlipRow> UpdatePackingSlipAsync(string id, object body, CancellationToken ct = default) =>
        PatchAsync<PackingSlipRow>($"/packing-slips/{id}", body, ct);

    public Task<PackingSlipRow> PackPackingSlipAsync(string id, CancellationToken ct = default) =>
        PostAsync<PackingSlipRow>($"/packing-slips/{id}/pack", new { }, ct: ct);

    // ── HTTP helpers ─────────────────────────────────────────────────────
    private async Task<T> GetAsync<T>(string path, CancellationToken ct, params (string key, string value)[] query)
    {
        var url = path;
        var parts = query.Where(p => !string.IsNullOrEmpty(p.value)).Select(p => $"{Uri.EscapeDataString(p.key)}={Uri.EscapeDataString(p.value)}").ToList();
        if (parts.Count > 0) url += "?" + string.Join("&", parts);
        using var req = new HttpRequestMessage(HttpMethod.Get, url.TrimStart('/'));
        ApplyAuth(req);
        using var res = await _http.SendAsync(req, ct);
        return await ReadAsync<T>(res);
    }

    private Task<T> PostAsync<T>(string path, object body, bool auth = true, CancellationToken ct = default) =>
        SendAsync<T>(HttpMethod.Post, path, body, auth, ct);

    private Task<T> PatchAsync<T>(string path, object body, CancellationToken ct = default) =>
        SendAsync<T>(HttpMethod.Patch, path, body, true, ct);

    private async Task DeleteAsync(string path, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Delete, path.TrimStart('/'));
        ApplyAuth(req);
        using var res = await _http.SendAsync(req, ct);
        await EnsureSuccessAsync(res);
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object body, bool auth, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path.TrimStart('/'))
        {
            Content = JsonContent.Create(body, options: JsonOpts),
        };
        if (auth) ApplyAuth(req);
        using var res = await _http.SendAsync(req, ct);
        return await ReadAsync<T>(res);
    }

    private void ApplyAuth(HttpRequestMessage req)
    {
        if (!string.IsNullOrEmpty(_session.Token))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _session.Token);
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage res)
    {
        await EnsureSuccessAsync(res);
        var data = await res.Content.ReadFromJsonAsync<T>(JsonOpts);
        return data ?? throw new ApiException((int)res.StatusCode, "Empty response body");
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage res)
    {
        if (res.IsSuccessStatusCode) return;
        var text = await res.Content.ReadAsStringAsync();
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("error", out var err) &&
                err.TryGetProperty("message", out var msg))
                throw new ApiException((int)res.StatusCode, msg.GetString() ?? text);
        }
        catch (ApiException) { throw; }
        catch { /* fall through */ }
        throw new ApiException((int)res.StatusCode, text.Length > 200 ? res.ReasonPhrase ?? "Request failed" : text);
    }
}
