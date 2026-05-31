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
    private readonly MainViewModel _main;

    public CheckoutViewModel(ApiClient api, CartService cart, AuthService auth, MainViewModel main)
    {
        _api = api; _cart = cart; _auth = auth; _main = main;
    }

    [ObservableProperty] private bool _isOpen;
    [ObservableProperty] private int _activeStep = 1;        // 1=ship, 2=delivery, 3=pay
    [ObservableProperty] private string _payMethod = "card"; // card | upi | cod
    [ObservableProperty] private string _deliveryMethod = "eco";

    // Shipping form
    [ObservableProperty] private string _name    = string.Empty;
    [ObservableProperty] private string _phone   = string.Empty;
    [ObservableProperty] private string _email   = string.Empty;
    [ObservableProperty] private string _address = string.Empty;
    [ObservableProperty] private string _pincode = string.Empty;
    [ObservableProperty] private string _city    = "Bangalore";
    [ObservableProperty] private string _state   = "Karnataka";

    // Card form
    [ObservableProperty] private string _cardNumber = string.Empty;
    [ObservableProperty] private string _cardName   = string.Empty;
    [ObservableProperty] private string _cardExpiry = string.Empty;
    [ObservableProperty] private string _cardCvv    = string.Empty;

    [ObservableProperty] private string? _statusMessage;
    [ObservableProperty] private bool _isSubmitting;

    public void Open()
    {
        if (_auth.IsAuthed)
        {
            Name  = _auth.User!.Name;
            Phone = _auth.User.Phone;
            Email = _auth.User.Email;
        }
        ActiveStep = 1;
        PayMethod = "card";
        DeliveryMethod = "eco";
        StatusMessage = null;
        IsOpen = true;
    }

    [RelayCommand] private void Close() => IsOpen = false;

    [RelayCommand] private void Step1() => ActiveStep = 1;
    [RelayCommand] private void Step2() => ActiveStep = 2;
    [RelayCommand] private void Step3() => ActiveStep = 3;

    [RelayCommand] private void PayCard() => PayMethod = "card";
    [RelayCommand] private void PayUpi()  => PayMethod = "upi";
    [RelayCommand] private void PayCod()  => PayMethod = "cod";

    [RelayCommand] private void DeliveryEco() => DeliveryMethod = "eco";
    [RelayCommand] private void DeliveryExp() => DeliveryMethod = "exp";

    [RelayCommand]
    private async Task PlaceOrder()
    {
        IsSubmitting = true;
        StatusMessage = null;
        try
        {
            var req = new StorefrontOrderRequest
            {
                Name  = Name.Trim(),
                Email = string.IsNullOrWhiteSpace(Email) ? "guest@prakruthivanam.com" : Email.Trim(),
                Phone = Phone.Trim(),
                City  = City.Trim(),
                Notes = $"Delivery: {DeliveryMethod}; Pay: {PayMethod}; Pin: {Pincode}; {Address}",
                Items = _cart.Lines.Select(l => new StorefrontOrderItem
                {
                    ProductId = l.ProductId, VariantId = l.VariantId, Qty = l.Qty,
                }).ToList(),
            };
            var resp = await _api.PlaceOrderAsync(req);
            if (resp is null) { StatusMessage = "Order failed."; return; }
            await _cart.ClearAsync();
            IsOpen = false;
            _main.OpenTracker(resp.SoNo, resp.InvoiceNo);
        }
        catch (System.Exception ex) { StatusMessage = $"Order failed: {ex.Message}"; }
        finally { IsSubmitting = false; }
    }
}
