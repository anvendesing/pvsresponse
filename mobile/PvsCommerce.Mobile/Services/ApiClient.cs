using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization.Metadata;
using System.Threading;
using System.Threading.Tasks;

namespace PvsCommerce.Mobile.Services;

// Thin wrapper around HttpClient that uses the source-generated JsonContext
// from Models/CatalogModels.cs so deserialization is trim/AOT safe.
//
// Reads AppConfig.ApiBaseUrl on every call (rather than freezing it on
// HttpClient.BaseAddress) so the runtime URL override from the Settings screen
// takes effect immediately without recreating the singleton HttpClient.
//
// All catalog reads are unauthenticated; auth is added later when we wire
// the LoginViewModel to /v1/auth/login.
public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly AppConfig _config;

    public ApiClient(HttpClient http, AppConfig config)
    {
        _http = http;
        _config = config;
        _http.Timeout = TimeSpan.FromSeconds(8);
    }

    public AppConfig Config => _config;

    private Uri BuildUri(string path)
    {
        var baseUrl = _config.ApiBaseUrl.TrimEnd('/');
        var rel = path.StartsWith('/') ? path : "/" + path;
        return new Uri(baseUrl + rel, UriKind.Absolute);
    }

    public Task<T?> GetAsync<T>(string path, JsonTypeInfo<T> typeInfo, CancellationToken ct = default)
        => _http.GetFromJsonAsync<T>(BuildUri(path), typeInfo, ct);

    // Convenience: fetch single product detail.
    public Task<Models.ProductDetail?> GetProductAsync(string id, CancellationToken ct = default)
        => GetAsync($"/storefront-mock/products/{id}", Models.CatalogJsonContext.Default.ProductDetail, ct);

    // Place an ecommerce order.
    public Task<Models.StorefrontOrderResponse?> PlaceOrderAsync(
        Models.StorefrontOrderRequest order,
        CancellationToken ct = default)
        => PostAsync(
            "/storefront-mock/order",
            order,
            Models.AppJsonContext.Default.StorefrontOrderRequest,
            Models.AppJsonContext.Default.StorefrontOrderResponse,
            ct);

    // Fetch past orders for a customer email.
    public Task<System.Collections.Generic.List<Models.PastOrder>?> GetOrdersAsync(
        string email,
        CancellationToken ct = default)
        => GetAsync($"/storefront-mock/orders?email={Uri.EscapeDataString(email)}",
            Models.AppJsonContext.Default.ListPastOrder, ct);

    public Task<TRes?> PostAsync<TReq, TRes>(
        string path,
        TReq body,
        JsonTypeInfo<TReq> reqInfo,
        JsonTypeInfo<TRes> resInfo,
        CancellationToken ct = default)
        where TReq : notnull
        => PostAsyncInternal(path, body, reqInfo, resInfo, ct);

    private async Task<TRes?> PostAsyncInternal<TReq, TRes>(
        string path,
        TReq body,
        JsonTypeInfo<TReq> reqInfo,
        JsonTypeInfo<TRes> resInfo,
        CancellationToken ct)
    {
        using var resp = await _http.PostAsJsonAsync(BuildUri(path), body, reqInfo, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<TRes>(resInfo, ct);
    }
}
