using System;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Cart + invoice calculation logic mirroring the HTML mock.
public partial class CartViewModel : ViewModelBase
{
    public CartService Cart { get; }
    private readonly AuthService _auth;
    private readonly MainViewModel _main;

    public CartViewModel(CartService cart, AuthService auth, MainViewModel main)
    {
        Cart = cart;
        _auth = auth;
        _main = main;
        Cart.PropertyChanged += (_, __) => Recalc();
        Cart.Lines.CollectionChanged += (_, __) => Recalc();
        Recalc();
    }

    [ObservableProperty] private string? _activeCoupon;
    [ObservableProperty] private string _couponInput = string.Empty;
    [ObservableProperty] private string? _couponSuccessMessage;
    [ObservableProperty] private double _discount;
    [ObservableProperty] private double _shipping;
    [ObservableProperty] private double _grandTotal;
    [ObservableProperty] private string _shippingMessage = "Add ₹3,000/- more for FREE Standard Shipping!";
    [ObservableProperty] private double _shippingProgress;
    [ObservableProperty] private string _packagingNote = string.Empty;
    [ObservableProperty] private string _activeDeliverySpeed = "eco";

    public bool IsEmpty => Cart.Lines.Count == 0;
    public bool IsNotEmpty => Cart.Lines.Count > 0;
    public double SubTotal => Cart.SubTotal;

    public string SubTotalFormatted => Format(SubTotal);
    public string DiscountFormatted => "- " + Format(Discount);
    public string ShippingFormatted => Shipping <= 0 ? "FREE" : Format(Shipping);
    public string GrandTotalFormatted => Format(GrandTotal);

    private static string Format(double d)
        => "₹" + d.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo("en-IN")) + "/-";

    [RelayCommand]
    private void ApplyCoupon()
    {
        var code = (CouponInput ?? "").Trim().ToUpperInvariant();
        if (code == "ORGANIC10")
        {
            ActiveCoupon = code;
            CouponSuccessMessage = "✓ ORGANIC10 applied: 10% basket discount!";
        }
        else if (code == "FREESHIP")
        {
            ActiveCoupon = code;
            CouponSuccessMessage = "✓ FREESHIP applied: Free delivery unlocked!";
        }
        else
        {
            ActiveCoupon = null;
            CouponSuccessMessage = "Invalid coupon code.";
        }
        Recalc();
    }

    [RelayCommand]
    private void SetDeliverySpeed(string speed)
    {
        ActiveDeliverySpeed = speed;
        Recalc();
    }

    [RelayCommand]
    private async Task IncrementLine(string lineKey)
    {
        var line = Cart.Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        await Cart.SetQtyAsync(lineKey, line.Qty + 1);
    }

    [RelayCommand]
    private async Task DecrementLine(string lineKey)
    {
        var line = Cart.Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        await Cart.SetQtyAsync(lineKey, line.Qty - 1);
    }

    [RelayCommand]
    private void Checkout()
    {
        if (Cart.Lines.Count == 0) return;
        if (!_auth.IsAuthed) { _main.SwitchTab("auth"); return; }
        _main.OpenCheckout();
    }

    [RelayCommand]
    private void GoShop() => _main.SwitchTab("shop");

    private void Recalc()
    {
        var sub = Cart.SubTotal;
        Discount = ActiveCoupon == "ORGANIC10" ? Math.Round(sub * 0.10) : 0;
        var ship = sub >= 3000 || ActiveCoupon == "FREESHIP" ? 0.0 : 100.0;
        if (ActiveDeliverySpeed == "exp") ship += 150;
        Shipping = ship;
        GrandTotal = sub - Discount + Shipping;

        if (sub >= 3000)
        {
            ShippingMessage = "✓ Free Standard Delivery Unlocked!";
            ShippingProgress = 100;
        }
        else
        {
            var rem = 3000 - sub;
            ShippingMessage = $"Add ₹{rem:N0}/- more for FREE Standard Shipping!";
            ShippingProgress = sub / 3000.0 * 100.0;
        }

        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(IsNotEmpty));
        OnPropertyChanged(nameof(SubTotal));
        OnPropertyChanged(nameof(SubTotalFormatted));
        OnPropertyChanged(nameof(DiscountFormatted));
        OnPropertyChanged(nameof(ShippingFormatted));
        OnPropertyChanged(nameof(GrandTotalFormatted));
    }
}
