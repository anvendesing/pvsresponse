using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class SalesOrdersViewModel : ViewModelBase
{
    private readonly ApiClient _api;

    public SalesOrdersViewModel(ApiClient api) => _api = api;

    public event Action<string>? PickListCreated;

    public ObservableCollection<SalesOrderRow> Items { get; } = [];

    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private SalesOrderRow? _selected;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var rows = await _api.GetSalesOrdersAsync(string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim());
            Items.Clear();
            foreach (var r in rows) Items.Add(r);
        }, "Loading sales orders…");
    }

    [RelayCommand]
    private async Task SearchAsync() => await LoadAsync();

    [RelayCommand]
    private async Task CreatePickListAsync()
    {
        if (Selected == null) return;
        await RunAsync(async () =>
        {
            var pl = await _api.CreatePickListAsync(Selected.Id);
            StatusMessage = $"Pick list {pl.PickListNo} created.";
            PickListCreated?.Invoke(pl.Id);
        }, "Creating pick list…");
    }
}
