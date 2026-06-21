using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly AppSession _session;
    private readonly CatalogCache _cache;

    public MainViewModel(
        ApiClient api,
        AppSession session,
        CatalogCache cache,
        QuotesViewModel quotes,
        SalesOrdersViewModel salesOrders,
        PickListsViewModel pickLists,
        PackingSlipsViewModel packingSlips,
        CustomersViewModel customers)
    {
        _api = api;
        _session = session;
        _cache = cache;
        Quotes = quotes;
        SalesOrders = salesOrders;
        PickLists = pickLists;
        PackingSlips = packingSlips;
        Customers = customers;
        Current = Quotes;
        Quotes.NewQuoteRequested += () => OpenQuoteEditor(null);
        Quotes.OpenQuoteRequested += id => OpenQuoteEditor(id);
        SalesOrders.PickListCreated += id => { ShowPickLists(); OpenPickEditor(id); };
        PickLists.OpenPickRequested += OpenPickEditor;
        PackingSlips.OpenPackRequested += OpenPackEditor;
        ShortcutHints = new ObservableCollection<string>
        {
            "Ctrl+1–5 modules · Ctrl+N new quote · Ctrl+S save · Ctrl+K customer · F3 product · F5 refresh · Esc back · F10 pick/pack",
        };
        _ = RefreshStatusAsync();
    }

    private async Task RefreshStatusAsync()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        BackendOnline = await _api.HealthCheckAsync();
        sw.Stop();
        ApiLatencyMs = BackendOnline ? (int)sw.ElapsedMilliseconds : 0;
    }

    public QuotesViewModel Quotes { get; }
    public SalesOrdersViewModel SalesOrders { get; }
    public PickListsViewModel PickLists { get; }
    public PackingSlipsViewModel PackingSlips { get; }
    public CustomersViewModel Customers { get; }

    [ObservableProperty] private ViewModelBase _current;
    [ObservableProperty] private QuoteEditorViewModel? _quoteEditor;
    [ObservableProperty] private PickListEditorViewModel? _pickEditor;
    [ObservableProperty] private PackingSlipEditorViewModel? _packEditor;
    [ObservableProperty] private string _activeModule = "quotes";
    [ObservableProperty] private int _apiLatencyMs = 42;
    [ObservableProperty] private bool _backendOnline = true;

    public string PageTitle => ActiveModule switch
    {
        "quotes" => "Quotes",
        "orders" => "Sales Orders",
        "pick" => "Picking",
        "pack" => "Packing",
        "customers" => "Customers",
        _ => "Sales Desk",
    };

    public ObservableCollection<string> ShortcutHints { get; }

    public string UserLine => _session.User is { } u ? $"{u.Name} · {u.Role}" : "";

    [RelayCommand]
    private void ShowQuotes() { Current = Quotes; ActiveModule = "quotes"; _ = Quotes.LoadAsync(); }

    [RelayCommand]
    private void ShowSalesOrders() { Current = SalesOrders; ActiveModule = "orders"; _ = SalesOrders.LoadAsync(); }

    [RelayCommand]
    private void ShowPickLists() { Current = PickLists; ActiveModule = "pick"; _ = PickLists.LoadAsync(); }

    [RelayCommand]
    private void ShowPackingSlips() { Current = PackingSlips; ActiveModule = "pack"; _ = PackingSlips.LoadAsync(); }

    [RelayCommand]
    private void ShowCustomers() { Current = Customers; ActiveModule = "customers"; _ = Customers.LoadAsync(); }

    [RelayCommand]
    private void NewQuote() => OpenQuoteEditor(null);

    [RelayCommand]
    private void GoBack()
    {
        if (QuoteEditor != null) { QuoteEditor = null; Current = Quotes; return; }
        if (PickEditor != null) { PickEditor = null; Current = PickLists; return; }
        if (PackEditor != null) { PackEditor = null; Current = PackingSlips; return; }
    }

    [RelayCommand]
    private async Task RefreshCurrentAsync()
    {
        await RefreshStatusAsync();
        switch (ActiveModule)
        {
            case "quotes": await Quotes.LoadAsync(); break;
            case "orders": await SalesOrders.LoadAsync(); break;
            case "pick": await PickLists.LoadAsync(); break;
            case "pack": await PackingSlips.LoadAsync(); break;
            case "customers": await Customers.LoadAsync(); break;
        }
    }

    public async Task PreloadCatalogAsync()
    {
        await _cache.EnsureCustomersAsync();
        await _cache.EnsureProductsAsync();
    }

    public void OpenQuoteEditor(string? quoteId)
    {
        QuoteEditor = new QuoteEditorViewModel(_api, _cache, quoteId, () => GoBackCommand.Execute(null));
        Current = QuoteEditor;
    }

    public void OpenPickEditor(string pickListId)
    {
        PickEditor = new PickListEditorViewModel(_api, pickListId, () => GoBackCommand.Execute(null), OpenPackEditor);
        Current = PickEditor;
    }

    public void OpenPackEditor(string packingSlipId)
    {
        PackEditor = new PackingSlipEditorViewModel(_api, packingSlipId, () => GoBackCommand.Execute(null));
        Current = PackEditor;
    }

    [RelayCommand]
    private void Logout()
    {
        _api.Logout();
        System.Windows.Application.Current.Shutdown();
        System.Diagnostics.Process.Start(Environment.ProcessPath ?? "");
    }
}
