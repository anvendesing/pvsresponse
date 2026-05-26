using System.Collections.ObjectModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.Models;

namespace NovaErp.ViewModels;

public partial class ManufacturingStationViewModel : ViewModelBase, IRefreshable
{
    private readonly MainViewModel _root;

    public ObservableCollection<ProductionOrder> Orders { get; } = new();

    [ObservableProperty]
    private ProductionOrder? _selected;

    [ObservableProperty]
    private string _statusMessage = "";

    public ManufacturingStationViewModel(MainViewModel root)
    {
        _root = root;
    }

    public async Task RefreshAsync()
    {
        try
        {
            Orders.Clear();
            if (_root.Api.IsAuthenticated)
            {
                var live = await _root.Api.GetProductionOrdersAsync();
                foreach (var o in live) Orders.Add(o);
            }
            if (Orders.Count == 0)
            {
                foreach (var o in await _root.Cache.GetProductionOrdersAsync()) Orders.Add(o);
            }
            Selected = Orders.Count > 0 ? Orders[0] : null;
            StatusMessage = $"Loaded {Orders.Count} orders";
        }
        catch (System.Exception e)
        {
            StatusMessage = "Offline · " + e.Message;
        }
    }

    [RelayCommand]
    public void Pick(ProductionOrder po)
    {
        Selected = po;
    }

    [RelayCommand]
    public Task IncrementOutputAsync()
    {
        if (Selected is null) return Task.CompletedTask;
        // Local optimistic update + queue server-side update via sync
        var idx = Orders.IndexOf(Selected);
        if (idx >= 0)
        {
            var updated = Selected with { ActualQty = Selected.ActualQty + 10 };
            Orders[idx] = updated;
            Selected = updated;
            StatusMessage = $"+10 logged for {updated.OrderNo}";
        }
        return Task.CompletedTask;
    }
}
