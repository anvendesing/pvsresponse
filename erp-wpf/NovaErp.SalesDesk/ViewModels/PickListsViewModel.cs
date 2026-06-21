using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class PickListsViewModel : ViewModelBase
{
    private readonly ApiClient _api;

    public PickListsViewModel(ApiClient api) => _api = api;

    public event Action<string>? OpenPickRequested;

    public ObservableCollection<PickListRow> Items { get; } = [];

    [ObservableProperty] private PickListRow? _selected;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var rows = await _api.GetPickListsAsync();
            Items.Clear();
            foreach (var r in rows.Where(p => p.Status != "cancelled")) Items.Add(r);
        }, "Loading pick lists…");
    }

    [RelayCommand]
    private void OpenSelected()
    {
        if (Selected != null) OpenPickRequested?.Invoke(Selected.Id);
    }
}
