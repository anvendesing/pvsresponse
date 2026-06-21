using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class CustomersViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly CatalogCache _cache;
    private bool _suppressSelectionReload;

    public CustomersViewModel(ApiClient api, CatalogCache cache)
    {
        _api = api;
        _cache = cache;
    }

    public ObservableCollection<CustomerRow> Filtered { get; } = [];
    public ObservableCollection<StatementEntry> StatementEntries { get; } = [];
    public ObservableCollection<CustomerPayment> Payments { get; } = [];

    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private CustomerRow? _selected;
    [ObservableProperty] private bool _isCreating;
    [ObservableProperty] private bool _hasSelection;
    [ObservableProperty] private bool _isLoadingDetail;

    // Detail header — bound directly (fixes nested DataContext bug)
    [ObservableProperty] private string _detailName = "";
    [ObservableProperty] private string _detailCode = "";
    [ObservableProperty] private string _detailSubtitle = "";
    [ObservableProperty] private string _detailGst = "";
    [ObservableProperty] private decimal _arBalance;
    [ObservableProperty] private decimal? _availableCredit;
    [ObservableProperty] private string _creditLimitText = "";

    [ObservableProperty] private string _newName = "";
    [ObservableProperty] private string _newAddressLine = "";
    [ObservableProperty] private string _newCity = "";
    [ObservableProperty] private string _newState = "";
    [ObservableProperty] private string _newPincode = "";
    [ObservableProperty] private string _newContact = "";
    [ObservableProperty] private string _newGst = "";
    [ObservableProperty] private decimal _newCreditLimit;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            await _cache.EnsureCustomersAsync();
            ApplyFilter();
            StatusMessage = $"{_cache.CustomerCount} customers cached · search is instant";
        }, "Loading customers…");
    }

    partial void OnSearchTextChanged(string value) => ApplyFilter();

    partial void OnSelectedChanged(CustomerRow? value)
    {
        HasSelection = value != null;
        if (value == null)
        {
            ClearDetail();
            return;
        }

        ApplyDetailHeader(value);
        if (!_suppressSelectionReload)
            _ = LoadCustomerDetailAsync(value.Id);
    }

    private void ApplyFilter()
    {
        Filtered.Clear();
        foreach (var c in _cache.FilterCustomers(SearchText, 200))
            Filtered.Add(c);
    }

    private void ApplyDetailHeader(CustomerRow c)
    {
        DetailName = c.Name;
        DetailCode = c.Code;
        DetailSubtitle = string.Join(" · ", new[] { c.City, c.State, c.Pincode, c.Contact }.Where(s => !string.IsNullOrWhiteSpace(s)));
        DetailGst = string.IsNullOrWhiteSpace(c.Gst) ? "—" : c.Gst!;
        ArBalance = c.OpenBalance;
        AvailableCredit = c.AvailableCredit;
        CreditLimitText = c.CreditLimit > 0 ? FormatInr(c.CreditLimit) : "Cash only";
    }

    private void ClearDetail()
    {
        DetailName = DetailCode = DetailSubtitle = DetailGst = CreditLimitText = "";
        ArBalance = 0;
        AvailableCredit = null;
        StatementEntries.Clear();
        Payments.Clear();
    }

    private async Task LoadCustomerDetailAsync(string id)
    {
        if (_cache.TryGetCustomerDetail(id, out var cached))
        {
            ApplyDetailBundle(cached);
            return;
        }

        IsLoadingDetail = true;
        try
        {
            var c = await _api.GetCustomerAsync(id);
            var stmt = await _api.GetCustomerStatementAsync(id);
            var pays = await _api.GetCustomerPaymentsAsync(id);
            var bundle = new CustomerDetailBundle
            {
                Customer = c,
                Statement = stmt,
                Payments = pays,
            };
            _cache.SetCustomerDetail(id, bundle);
            _suppressSelectionReload = true;
            Selected = c;
            _suppressSelectionReload = false;
            ApplyDetailBundle(bundle);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsLoadingDetail = false;
        }
    }

    private void ApplyDetailBundle(CustomerDetailBundle bundle)
    {
        ApplyDetailHeader(bundle.Customer);
        StatementEntries.Clear();
        foreach (var e in bundle.Statement.Entries)
            StatementEntries.Add(e);
        Payments.Clear();
        foreach (var p in bundle.Payments.OrderByDescending(x => x.PaymentDate))
            Payments.Add(p);
    }

    [RelayCommand]
    private void StartCreate()
    {
        IsCreating = true;
        NewName = NewAddressLine = NewCity = NewState = NewPincode = NewContact = NewGst = "";
        NewCreditLimit = 0;
    }

    [RelayCommand]
    private void CancelCreate() => IsCreating = false;

    [RelayCommand]
    private async Task SaveNewCustomerAsync()
    {
        await RunAsync(async () =>
        {
            if (string.IsNullOrWhiteSpace(NewName)) throw new InvalidOperationException("Name is required.");
            if (string.IsNullOrWhiteSpace(NewAddressLine)) throw new InvalidOperationException("Address is required.");
            if (string.IsNullOrWhiteSpace(NewCity)) throw new InvalidOperationException("City is required.");
            if (NewPincode.Trim().Length != 6) throw new InvalidOperationException("Pincode must be 6 digits.");

            var created = await _api.CreateCustomerAsync(new CustomerInput
            {
                Name = NewName.Trim(),
                AddressLine = NewAddressLine.Trim(),
                City = NewCity.Trim(),
                State = string.IsNullOrWhiteSpace(NewState) ? null : NewState.Trim(),
                Pincode = NewPincode.Trim(),
                Contact = string.IsNullOrWhiteSpace(NewContact) ? null : NewContact.Trim(),
                Gst = string.IsNullOrWhiteSpace(NewGst) ? null : NewGst.Trim(),
                CreditLimit = NewCreditLimit,
            });
            _cache.UpsertCustomer(created);
            IsCreating = false;
            ApplyFilter();
            Selected = created;
            StatusMessage = $"Created {created.Code} · {created.Name}";
        }, "Creating customer…");
    }

    public static string FormatInr(decimal amount) =>
        amount.ToString("N2", CultureInfo.GetCultureInfo("en-IN"));
}
