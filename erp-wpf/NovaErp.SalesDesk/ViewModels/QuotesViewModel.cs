using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class QuotesViewModel : ViewModelBase
{
    private readonly ApiClient _api;

    public QuotesViewModel(ApiClient api) => _api = api;

    public ObservableCollection<QuoteRow> Items { get; } = [];

    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private QuoteRow? _selected;

    public event Action? NewQuoteRequested;
    public event Action<string>? OpenQuoteRequested;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var rows = await _api.GetQuotesAsync(string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim());
            Items.Clear();
            foreach (var r in rows.OrderByDescending(q => q.QuoteNo)) Items.Add(r);
        }, "Loading quotes…");
    }

    [RelayCommand]
    private async Task SearchAsync() => await LoadAsync();

    [RelayCommand]
    private void NewQuote() => NewQuoteRequested?.Invoke();

    [RelayCommand]
    private void OpenSelected()
    {
        if (Selected != null) OpenQuoteRequested?.Invoke(Selected.Id);
    }
}
