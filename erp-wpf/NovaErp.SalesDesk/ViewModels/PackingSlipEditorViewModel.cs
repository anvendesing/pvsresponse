using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class PackingSlipEditorViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly Action _goBack;
    private readonly string _id;

    public PackingSlipEditorViewModel(ApiClient api, string id, Action goBack)
    {
        _api = api;
        _goBack = goBack;
        _id = id;
        _ = LoadAsync();
    }

    [ObservableProperty] private string _header = "Packing Slip";
    [ObservableProperty] private string _status = "";

    public ObservableCollection<PackLineVm> Lines { get; } = [];

    private async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var ps = await _api.GetPackingSlipAsync(_id);
            Header = $"{ps.PackingSlipNo} · SO {ps.SalesOrder?.SoNo}";
            Status = ps.Status;
            Lines.Clear();
            foreach (var item in ps.Items)
            {
                Lines.Add(new PackLineVm
                {
                    Id = item.Id,
                    Sku = item.Product?.Sku ?? "",
                    Name = item.Product?.Name ?? "",
                    QtyPicked = item.QtyPicked,
                    QtyPacked = item.QtyPacked > 0 ? item.QtyPacked : item.QtyPicked,
                });
            }
        }, "Loading packing slip…");
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        await RunAsync(async () =>
        {
            await _api.UpdatePackingSlipAsync(_id, new
            {
                items = Lines.Select(l => new { id = l.Id, qtyPacked = l.QtyPacked }).ToList(),
            });
            StatusMessage = "Pack quantities saved.";
        }, "Saving…");
    }

    [RelayCommand]
    private async Task PackAsync()
    {
        await SaveAsync();
        if (!string.IsNullOrEmpty(ErrorMessage)) return;
        await RunAsync(async () =>
        {
            var ps = await _api.PackPackingSlipAsync(_id);
            Status = ps.Status;
            StatusMessage = "Packing slip locked and invoiced.";
        }, "Packing…");
    }

    [RelayCommand]
    private void Back() => _goBack();
}

public partial class PackLineVm : ObservableObject
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal QtyPicked { get; set; }
    [ObservableProperty] private decimal _qtyPacked;
}
