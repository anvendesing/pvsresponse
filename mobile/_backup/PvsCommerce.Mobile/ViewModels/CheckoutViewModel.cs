using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class CheckoutViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly CartService _cart;
    private readonly AuthService _auth;
    private readonly NavigationService _nav;

    public CheckoutViewModel(ApiClient api, CartService cart, AuthService auth, NavigationService nav)
    {
        _api = api; _cart = cart; _auth = auth; _nav = nav;
        // Pre-fill from stored auth profile
        Name  = auth.User?.Name  ?? "";
        Email = auth.User?.Email ?? "";
        Phone = auth.User?.Phone ?? "";
    }

    [ObservableProperty] private string _name  = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _phone = "";
    [ObservableProperty] private string _city  = "";
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private bool _isPlacing;
    [ObservableProperty] private string? _errorMessage;
    [ObservableProperty] private bool _success;
    [ObservableProperty] private string _orderNo = "";

    public CartService Cart => _cart;

    [RelayCommand(CanExecute = nameof(CanPlace))]
    private async Task PlaceOrderAsync()
    {
        if (!CanPlace()) return;
        IsPlacing = true; ErrorMessage = null;
        try
        {
            var req = new StorefrontOrderRequest
            {
                Name  = Name.Trim(),
                Email = Email.Trim().ToLowerInvariant(),
                Phone = Phone.Trim(),
                City  = string.IsNullOrWhiteSpace(City) ? null : City.Trim(),
                Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim(),
                Items = _cart.Lines.Select(l => new StorefrontOrderItem
                {
                    ProductId = l.ProductId,
                    VariantId = l.VariantId,
                    Qty       = l.Qty,
                }).ToList(),
            };

            var res = await _api.PlaceOrderAsync(req);
            if (res is null) { ErrorMessage = "Order failed — no response from server."; return; }

            OrderNo = res.SoNo;
            Success = true;
            await _cart.ClearAsync();

            // Persist email/name/phone if not already saved
            if (!_auth.IsAuthed)
                _auth.SignIn(new AuthUser { Name = req.Name, Email = req.Email, Phone = req.Phone });
        }
        catch (System.Exception ex) { ErrorMessage = ex.Message; }
        finally { IsPlacing = false; }
    }

    private bool CanPlace() =>
        !IsPlacing &&
        !string.IsNullOrWhiteSpace(Name) &&
        !string.IsNullOrWhiteSpace(Email) &&
        !string.IsNullOrWhiteSpace(Phone);

    [RelayCommand]
    private void GoBack() => _nav.GoBack();

    [RelayCommand]
    private void ContinueShopping()
    {
        var homeVm = App.Services.GetRequiredService<HomeViewModel>();
        (_nav as NavigationService)?.NavigateRoot(homeVm);
    }
}
