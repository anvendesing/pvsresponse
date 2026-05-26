using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using PvsCommerce.Mobile.Models;

namespace PvsCommerce.Mobile.Services;

// One-shot fetch of /storefront-mock/catalog, cached in memory for the
// lifetime of the app session. Pages call EnsureLoadedAsync() in their
// constructor; the singleton ensures we don't fan out duplicate requests
// when the user navigates back and forth.
public sealed class CatalogService
{
    private readonly ApiClient _api;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private List<CatalogProduct>? _cache;

    public CatalogService(ApiClient api) => _api = api;

    public IReadOnlyList<CatalogProduct> Products => _cache ?? (IReadOnlyList<CatalogProduct>)System.Array.Empty<CatalogProduct>();

    public async Task<IReadOnlyList<CatalogProduct>> EnsureLoadedAsync(CancellationToken ct = default)
    {
        if (_cache is not null) return _cache;

        await _gate.WaitAsync(ct);
        try
        {
            if (_cache is not null) return _cache;
            var list = await _api.GetAsync(
                "/storefront-mock/catalog",
                CatalogJsonContext.Default.ListCatalogProduct,
                ct);
            _cache = list ?? new List<CatalogProduct>();
            return _cache;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<CatalogProduct>> RefreshAsync(CancellationToken ct = default)
    {
        _cache = null;
        return await EnsureLoadedAsync(ct);
    }

    // Drop the in-memory cache without re-fetching. Used when the API URL
    // changes via the Settings screen so the next page navigation hits the
    // new endpoint instead of returning stale data.
    public void Invalidate() => _cache = null;

    // Resolve a (possibly relative) imageUrl into a fully-qualified URL the
    // image loader can fetch. Backend serves "/uploads/products/foo.jpg",
    // we prepend the configured ImageOrigin.
    public string? ResolveImageUrl(string? imageUrl)
    {
        if (string.IsNullOrEmpty(imageUrl)) return null;
        if (imageUrl.StartsWith("http://") || imageUrl.StartsWith("https://"))
            return imageUrl;
        var origin = _api.Config.ImageOrigin.TrimEnd('/');
        return origin + (imageUrl.StartsWith("/") ? imageUrl : "/" + imageUrl);
    }
}
