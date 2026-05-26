using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class CartViewModel : ViewModelBase
{
    private readonly CartService _cart;
    private readonly NavigationService _nav;

    public CartViewModel(CartService cart, NavigationService nav)
    {
        _cart = cart;
        _nav = nav;
    }

    public CartService Cart => _cart;

    public string SubTotalFormatted =>
        "₹" + _cart.SubTotal.ToString("N0", CultureInfo.GetCultureInfo("en-IN"));

    [RelayCommand]
    private async System.Threading.Tasks.Task IncAsync(string lineKey)
    {
        var line = _cart.Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        await _cart.SetQtyAsync(lineKey, line.Qty + 1);
        OnPropertyChanged(nameof(SubTotalFormatted));
    }

    [RelayCommand]
    private async System.Threading.Tasks.Task DecAsync(string lineKey)
    {
        var line = _cart.Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        await _cart.SetQtyAsync(lineKey, line.Qty - 1);
        OnPropertyChanged(nameof(SubTotalFormatted));
    }

    [RelayCommand]
    private async System.Threading.Tasks.Task RemoveAsync(string lineKey)
    {
        await _cart.RemoveAsync(lineKey);
        OnPropertyChanged(nameof(SubTotalFormatted));
    }

    [RelayCommand]
    private void Checkout()
    {
        if (_cart.Count == 0) return;
        var vm = App.Services.GetRequiredService<CheckoutViewModel>();
        _nav.NavigateTo(vm);
    }

    [RelayCommand]
    private void ContinueShopping() => _nav.GoBack();
}
