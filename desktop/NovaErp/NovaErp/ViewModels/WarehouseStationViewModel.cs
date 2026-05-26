using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.Models;

namespace NovaErp.ViewModels;

public partial class WarehouseStationViewModel : ViewModelBase, IRefreshable
{
    private readonly MainViewModel _root;

    [ObservableProperty]
    private string _scanCode = "";

    [ObservableProperty]
    private string _step = "Scan product"; // Scan product | Scan source | Scan dest | Enter qty

    [ObservableProperty]
    private string _productName = "";

    [ObservableProperty]
    private string _productSku = "";

    [ObservableProperty]
    private string _sourceBin = "";

    [ObservableProperty]
    private string _destBin = "";

    [ObservableProperty]
    private string _qty = "1";

    [ObservableProperty]
    private string _statusMessage = "Awaiting scan…";

    [ObservableProperty]
    private string _statusTone = "neutral"; // neutral | success | warning | danger

    [ObservableProperty]
    private string _selectedProductId = "";

    public ObservableCollection<Product> RecentScans { get; } = new();

    public WarehouseStationViewModel(MainViewModel root)
    {
        _root = root;
    }

    [RelayCommand]
    public async Task ScanAsync()
    {
        var code = ScanCode.Trim();
        ScanCode = "";
        if (string.IsNullOrEmpty(code))
        {
            StatusMessage = "Empty code";
            StatusTone = "warning";
            return;
        }

        if (Step == "Scan product")
        {
            // Try local cache first (fast offline path), then live API.
            var p = await _root.Cache.FindByBarcodeAsync(code);
            if (p is null && _root.Api.IsAuthenticated)
            {
                try { p = await _root.Api.GetProductByBarcodeAsync(code); }
                catch { /* offline */ }
            }
            if (p is null)
            {
                StatusMessage = $"Unknown code: {code}";
                StatusTone = "danger";
                return;
            }
            ProductName = p.Name;
            ProductSku = p.Sku;
            SelectedProductId = p.Id;
            if (RecentScans.Count >= 6) RecentScans.RemoveAt(RecentScans.Count - 1);
            if (!RecentScans.Any(x => x.Id == p.Id)) RecentScans.Insert(0, p);
            Step = "Scan source bin";
            StatusMessage = $"Product loaded · {p.Sku}";
            StatusTone = "success";
        }
        else if (Step == "Scan source bin")
        {
            SourceBin = code;
            Step = "Scan destination bin";
            StatusMessage = $"Source set · {code}";
            StatusTone = "success";
        }
        else if (Step == "Scan destination bin")
        {
            DestBin = code;
            Step = "Enter qty";
            StatusMessage = "Enter quantity and confirm with F8.";
            StatusTone = "success";
        }
    }

    [RelayCommand]
    public async Task CompleteAsync()
    {
        if (Step != "Enter qty")
        {
            StatusMessage = "Complete the scan flow first.";
            StatusTone = "warning";
            return;
        }
        if (!double.TryParse(Qty, out var q) || q <= 0)
        {
            StatusMessage = "Quantity must be a positive number.";
            StatusTone = "danger";
            return;
        }

        // Queue locally for offline-first; sync worker pushes when online.
        _root.Sync.EnqueueTransfer(SelectedProductId, q, "WH-MAIN", SourceBin, "WH-FG", DestBin);

        StatusMessage = $"Transfer queued · {q} units {ProductSku} → {DestBin}";
        StatusTone = "success";
        Reset();
        await Task.CompletedTask;
    }

    [RelayCommand]
    public void Reset()
    {
        Step = "Scan product";
        ProductName = "";
        ProductSku = "";
        SourceBin = "";
        DestBin = "";
        Qty = "1";
    }

    public async Task RefreshAsync()
    {
        try
        {
            if (_root.Api.IsAuthenticated)
            {
                var live = await _root.Api.GetProductsAsync();
                foreach (var p in live) _root.Cache.UpsertProduct(p, 1);
            }
        }
        catch { /* ignore */ }
    }
}
