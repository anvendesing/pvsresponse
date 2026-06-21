using NovaErp.SalesDesk.Models;

namespace NovaErp.SalesDesk.Services;

/// <summary>
/// In-memory catalog cache — one server fetch per session, local filter as-you-type.
/// </summary>
public sealed class CatalogCache
{
    private readonly ApiClient _api;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private List<CustomerRow> _customers = [];
    private List<Product> _products = [];
    private bool _customersLoaded;
    private bool _productsLoaded;

    private readonly Dictionary<string, CustomerDetailBundle> _customerDetails = new();

    public CatalogCache(ApiClient api) => _api = api;

    public bool CustomersReady => _customersLoaded;
    public int CustomerCount => _customers.Count;

    public async Task EnsureCustomersAsync(CancellationToken ct = default)
    {
        if (_customersLoaded) return;
        await _gate.WaitAsync(ct);
        try
        {
            if (_customersLoaded) return;
            _customers = await _api.GetCustomersAsync(ct);
            _customersLoaded = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task EnsureProductsAsync(CancellationToken ct = default)
    {
        if (_productsLoaded) return;
        await _gate.WaitAsync(ct);
        try
        {
            if (_productsLoaded) return;
            // Single bulk load — filter locally in quote editor.
            _products = await _api.GetProductsAsync(500, ct);
            _productsLoaded = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public IReadOnlyList<CustomerRow> FilterCustomers(string query, int limit = 25)
    {
        var term = query.Trim();
        IEnumerable<CustomerRow> src = _customers;
        if (!string.IsNullOrEmpty(term))
        {
            src = _customers.Where(c =>
                c.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                c.Code.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                (c.Gst?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.City?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Pincode?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.AddressLine?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Contact?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false));
        }
        return src.OrderBy(c => c.Name).Take(limit).ToList();
    }

    public IReadOnlyList<Product> FilterProducts(string query, int limit = 30)
    {
        var term = query.Trim();
        IEnumerable<Product> src = _products;
        if (!string.IsNullOrEmpty(term))
        {
            src = _products.Where(p =>
                p.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                p.Sku.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                (p.Barcode?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false));
        }
        return src.Take(limit).ToList();
    }

    public bool TryGetCustomerDetail(string id, out CustomerDetailBundle bundle) =>
        _customerDetails.TryGetValue(id, out bundle!);

    public void SetCustomerDetail(string id, CustomerDetailBundle bundle) =>
        _customerDetails[id] = bundle;

    public void InvalidateCustomers()
    {
        _customersLoaded = false;
        _customers = [];
        _customerDetails.Clear();
    }

    public void UpsertCustomer(CustomerRow row)
    {
        var idx = _customers.FindIndex(c => c.Id == row.Id);
        if (idx >= 0) _customers[idx] = row;
        else _customers.Add(row);
        _customersLoaded = true;
    }
}

public sealed class CustomerDetailBundle
{
    public CustomerRow Customer { get; init; } = new();
    public CustomerStatement Statement { get; init; } = new();
    public List<CustomerPayment> Payments { get; init; } = [];
}
