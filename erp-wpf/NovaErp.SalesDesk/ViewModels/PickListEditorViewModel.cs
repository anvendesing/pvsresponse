using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class PickListEditorViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly Action _goBack;
    private readonly string _id;

    public PickListEditorViewModel(ApiClient api, string id, Action goBack, Action<string>? onPacked = null)
    {
        _api = api;
        _goBack = goBack;
        _id = id;
        OnPacked = onPacked;
        _ = LoadAsync();
    }

    public Action<string>? OnPacked { get; }

    [ObservableProperty] private string _header = "Pick List";
    [ObservableProperty] private string _status = "";
    [ObservableProperty] private string _customerLine = "";

    public ObservableCollection<PickLineVm> Lines { get; } = [];

    private async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var pl = await _api.GetPickListAsync(_id);
            Header = $"{pl.PickListNo} · SO {pl.SalesOrder?.SoNo}";
            Status = pl.Status;
            CustomerLine = pl.SalesOrder?.Customer?.Name ?? "";
            Lines.Clear();
            foreach (var item in pl.Items)
            {
                Lines.Add(new PickLineVm
                {
                    Id = item.Id,
                    Sku = item.Product?.Sku ?? "",
                    Name = item.Product?.Name ?? "",
                    BinPath = item.Bin?.Path ?? "—",
                    QtyToPick = item.QtyToPick,
                    QtyPicked = item.QtyPicked,
                });
            }
        }, "Loading pick list…");
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        await RunAsync(async () =>
        {
            await _api.UpdatePickListAsync(_id, new
            {
                items = Lines.Select(l => new { id = l.Id, qtyPicked = l.QtyPicked }).ToList(),
            });
            StatusMessage = "Pick quantities saved.";
        }, "Saving…");
    }

    [RelayCommand]
    private async Task CompleteAsync()
    {
        await SaveAsync();
        if (!string.IsNullOrEmpty(ErrorMessage)) return;
        await RunAsync(async () =>
        {
            var res = await _api.CompletePickListAsync(_id);
            Status = res.PickList.Status;
            StatusMessage = $"Pick complete → packing slip {res.PackingSlip.PackingSlipNo}";
            OnPacked?.Invoke(res.PackingSlip.Id);
        }, "Completing pick…");
    }

    [RelayCommand]
    private void Back() => _goBack();
}

public partial class PickLineVm : ObservableObject
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string BinPath { get; set; } = "";
    public decimal QtyToPick { get; set; }
    [ObservableProperty] private decimal _qtyPicked;
}
