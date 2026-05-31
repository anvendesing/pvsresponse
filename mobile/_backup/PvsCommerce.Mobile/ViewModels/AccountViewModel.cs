using System.Collections.ObjectModel;
using System.Globalization;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class AccountViewModel : ViewModelBase
{
    private readonly AuthService _auth;
    private readonly ApiClient _api;
    private readonly NavigationService _nav;

    public AccountViewModel(AuthService auth, ApiClient api, NavigationService nav)
    {
        _auth = auth; _api = api; _nav = nav;
        Orders = new ObservableCollection<PastOrderVm>();
    }

    public AuthService Auth => _auth;

    [ObservableProperty] private bool _isLoadingOrders;
    [ObservableProperty] private string? _ordersError;
    public ObservableCollection<PastOrderVm> Orders { get; }

    public async Task LoadOrdersAsync()
    {
        if (!_auth.IsAuthed || _auth.User?.Email is null) return;
        IsLoadingOrders = true; OrdersError = null;
        try
        {
            var list = await _api.GetOrdersAsync(_auth.User.Email);
            Orders.Clear();
            if (list is not null)
                foreach (var o in list)
                    Orders.Add(new PastOrderVm(o));
        }
        catch (System.Exception ex) { OrdersError = ex.Message; }
        finally { IsLoadingOrders = false; }
    }

    [RelayCommand]
    private void SignOut() => _auth.SignOut();

    [RelayCommand]
    private void GoToLogin()
    {
        var vm = App.Services.GetRequiredService<LoginViewModel>();
        _nav.NavigateTo(vm);
    }

    [RelayCommand]
    private void GoToSettings()
    {
        var vm = App.Services.GetRequiredService<SettingsViewModel>();
        _nav.NavigateTo(vm);
    }
}

public sealed class PastOrderVm
{
    public PastOrderVm(PastOrder o)
    {
        SoNo = o.SoNo;
        Status = o.Status;
        Date = o.CreatedAt.Length > 10 ? o.CreatedAt[..10] : o.CreatedAt;
        Total = "₹" + o.Total.ToString("N0", CultureInfo.GetCultureInfo("en-IN"));
        ItemSummary = $"{o.Lines.Count} item{(o.Lines.Count == 1 ? "" : "s")}";
    }
    public string SoNo { get; }
    public string Status { get; }
    public string Date { get; }
    public string Total { get; }
    public string ItemSummary { get; }
    public string StatusEmoji => Status switch
    {
        "confirmed" => "✅",
        "delivered" => "📦",
        "cancelled" => "❌",
        _ => "⏳"
    };
}
