using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class QuoteEditorViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly CatalogCache _cache;
    private readonly Action _goBack;
    private string? _quoteId;

    public QuoteEditorViewModel(ApiClient api, CatalogCache cache, string? quoteId, Action goBack)
    {
        _api = api;
        _cache = cache;
        _goBack = goBack;
        _quoteId = quoteId;
        _ = InitializeAsync();
    }

    [ObservableProperty] private string _title = "New Quote";
    [ObservableProperty] private string _quoteNo = "(draft)";
    [ObservableProperty] private string _status = "draft";
    [ObservableProperty] private string _customerSearch = "";
    [ObservableProperty] private string _productSearch = "";
    [ObservableProperty] private CustomerRow? _selectedCustomer;
    [ObservableProperty] private Product? _selectedProduct;
    [ObservableProperty] private ProductVariant? _selectedVariant;
    [ObservableProperty] private decimal _lineQty = 1;
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private decimal _total;
    [ObservableProperty] private bool _isReadOnly;
    [ObservableProperty] private bool _showCustomerMatches;
    [ObservableProperty] private bool _showProductMatches;

    public ObservableCollection<CustomerRow> CustomerMatches { get; } = [];
    public ObservableCollection<Product> ProductMatches { get; } = [];

    public ObservableCollection<QuoteLineDraft> Lines { get; } = [];

    private async Task InitializeAsync()
    {
        await _cache.EnsureCustomersAsync();
        await _cache.EnsureProductsAsync();

        await RunAsync(async () =>
        {
            if (_quoteId == null) return;
            var q = await _api.GetQuoteAsync(_quoteId);
            Title = $"Quote {q.QuoteNo}";
            QuoteNo = q.QuoteNo;
            Status = q.Status;
            Notes = q.Notes ?? "";
            Total = q.Total;
            IsReadOnly = q.Status is "converted" or "rejected";
            if (q.Customer != null)
            {
                SelectedCustomer = q.Customer;
                CustomerSearch = q.Customer.DisplayLine;
            }
            Lines.Clear();
            foreach (var item in q.Items)
            {
                Lines.Add(new QuoteLineDraft
                {
                    ProductId = item.ProductId,
                    VariantId = item.VariantId,
                    Sku = item.Product?.Sku ?? "",
                    Name = item.Product?.Name ?? "",
                    VariantLabel = item.Variant?.Label ?? "",
                    Qty = item.Qty,
                    Rate = item.Rate,
                    Discount = item.Discount,
                });
            }
        }, "Loading quote…");
    }

    partial void OnCustomerSearchChanged(string value)
    {
        if (SelectedCustomer != null && value == SelectedCustomer.DisplayLine) return;
        var matches = _cache.FilterCustomers(value, 15);
        CustomerMatches.Clear();
        foreach (var m in matches) CustomerMatches.Add(m);
        ShowCustomerMatches = !string.IsNullOrWhiteSpace(value) && CustomerMatches.Count > 0;
    }

    partial void OnProductSearchChanged(string value)
    {
        var matches = _cache.FilterProducts(value, 20);
        ProductMatches.Clear();
        foreach (var m in matches) ProductMatches.Add(m);
        ShowProductMatches = !string.IsNullOrWhiteSpace(value) && ProductMatches.Count > 0;
        if (matches.Count == 1 && value.Length >= 3)
            SelectedProduct = matches[0];
    }

    [RelayCommand]
    private void PickCustomer(CustomerRow? c)
    {
        if (c == null) return;
        SelectedCustomer = c;
        CustomerSearch = c.DisplayLine;
        ShowCustomerMatches = false;
        CustomerMatches.Clear();
    }

    [RelayCommand]
    private void PickProduct(Product? p)
    {
        if (p == null) return;
        SelectedProduct = p;
        ProductSearch = p.Display;
        ShowProductMatches = false;
        SelectedVariant = p.Variants?.FirstOrDefault(v => v.Active);
    }

    [RelayCommand]
    private async Task AddLineAsync()
    {
        if (SelectedProduct == null) { ErrorMessage = "Select a product (F3 or type to search)."; return; }
        decimal rate = SelectedProduct.SellingPrice;
        if (SelectedVariant?.SellingPriceOverride is decimal ov) rate = ov;
        if (SelectedCustomer != null)
        {
            var resolved = await _api.ResolvePriceAsync(
                SelectedProduct.Id,
                SelectedVariant?.Id,
                SelectedCustomer.Id,
                LineQty);
            if (resolved.Price > 0) rate = resolved.Price;
        }
        Lines.Add(new QuoteLineDraft
        {
            ProductId = SelectedProduct.Id,
            VariantId = SelectedVariant?.Id,
            Sku = SelectedProduct.Sku,
            Name = SelectedProduct.Name,
            VariantLabel = SelectedVariant?.Label ?? "",
            Qty = LineQty,
            Rate = rate,
        });
        RecalcTotal();
        ProductSearch = "";
        ShowProductMatches = false;
        ProductMatches.Clear();
        SelectedProduct = null;
        SelectedVariant = null;
        LineQty = 1;
    }

    [RelayCommand]
    private void RemoveLine(QuoteLineDraft? line)
    {
        if (line == null) return;
        Lines.Remove(line);
        RecalcTotal();
    }

    private void RecalcTotal() => Total = Lines.Sum(l => l.Amount);

    [RelayCommand]
    private void Back() => _goBack();

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (SelectedCustomer == null) { ErrorMessage = "Select a customer (Ctrl+K)."; return; }
        if (Lines.Count == 0) { ErrorMessage = "Add at least one line item."; return; }

        await RunAsync(async () =>
        {
            var payload = new QuoteCreatePayload
            {
                CustomerId = SelectedCustomer.Id,
                Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes,
                Items = Lines.Select(l => new QuoteItemPayload
                {
                    ProductId = l.ProductId,
                    VariantId = l.VariantId,
                    Qty = l.Qty,
                    Rate = l.Rate,
                    Discount = l.Discount,
                }).ToList(),
            };

            QuoteRow saved;
            if (_quoteId == null)
                saved = await _api.CreateQuoteAsync(payload);
            else
                saved = await _api.UpdateQuoteAsync(_quoteId, payload);

            _quoteId = saved.Id;
            QuoteNo = saved.QuoteNo;
            Status = saved.Status;
            Title = $"Quote {saved.QuoteNo}";
            Total = saved.Total;
            StatusMessage = "Saved.";
        }, "Saving…");
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        await SaveAsync();
        if (_quoteId == null || !string.IsNullOrEmpty(ErrorMessage)) return;
        await RunAsync(async () =>
        {
            var q = await _api.SubmitQuoteAsync(_quoteId);
            Status = q.Status;
            StatusMessage = "Submitted.";
        }, "Submitting…");
    }

    [RelayCommand]
    private async Task ConvertToSalesOrderAsync()
    {
        if (_quoteId == null) { ErrorMessage = "Save the quote first."; return; }
        if (Status is not ("submitted" or "draft" or "accepted"))
        {
            ErrorMessage = $"Cannot convert quote in status '{Status}'.";
            return;
        }
        if (Status == "draft") await SubmitAsync();
        await RunAsync(async () =>
        {
            var res = await _api.AcceptQuoteAsync(_quoteId);
            if (res.CreditHold)
            {
                ErrorMessage = res.Message ?? "Credit limit approval required before SO creation.";
                return;
            }
            if (res.SalesOrder is { } so)
            {
                Status = "converted";
                IsReadOnly = true;
                StatusMessage = res.AlreadyConverted
                    ? $"Already converted → SO {so.SoNo}"
                    : $"Converted → SO {so.SoNo}";
            }
        }, "Converting to sales order…");
    }
}
