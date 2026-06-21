using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class PackingSlipsViewModel : ViewModelBase
{
    private readonly ApiClient _api;

    public PackingSlipsViewModel(ApiClient api) => _api = api;

    public event Action<string>? OpenPackRequested;

    public ObservableCollection<PackingSlipRow> Items { get; } = [];

    [ObservableProperty] private PackingSlipRow? _selected;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var rows = await _api.GetPackingSlipsAsync();
            Items.Clear();
            foreach (var r in rows.Where(p => p.Status != "cancelled")) Items.Add(r);
        }, "Loading packing slips…");
    }

    [RelayCommand]
    private void OpenSelected()
    {
        if (Selected != null) OpenPackRequested?.Invoke(Selected.Id);
    }
}
