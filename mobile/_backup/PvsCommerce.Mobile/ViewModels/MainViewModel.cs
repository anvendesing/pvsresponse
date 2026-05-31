using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Shell view-model. Owns CurrentPage (bound to a ContentControl in MainView)
// and the bottom navigation bar. All routing flows through NavigationService.
public partial class MainViewModel : ViewModelBase
{
    private readonly NavigationService _nav;
    private readonly HomeViewModel _home;

    public MainViewModel(NavigationService nav, HomeViewModel home, CartService cart, AuthService auth)
    {
        _nav = nav;
        _home = home;
        Cart = cart;
        Auth = auth;

        // Start on the home page
        _nav.NavigateTo(home);
        _ = home.LoadAsync();
    }

    // Expose navigation state to the shell view
    public NavigationService Navigation => _nav;
    public CartService Cart { get; }
    public AuthService Auth { get; }

    [RelayCommand]
    private void GoBack() => _nav.GoBack();

    // ── Bottom nav ──────────────────────────────────────────────────────────
    [RelayCommand]
    private void GoHome()
    {
        _nav.NavigateRoot(_home);
        // Reload if catalog has already been fetched (no-op due to cache)
        _ = _home.LoadAsync();
    }

    [RelayCommand]
    private void GoCart()
    {
        var vm = App.Services.GetRequiredService<CartViewModel>();
        _nav.NavigateRoot(vm);
    }

    [RelayCommand]
    private void GoAccount()
    {
        var vm = App.Services.GetRequiredService<AccountViewModel>();
        _nav.NavigateRoot(vm);
        _ = vm.LoadOrdersAsync();
    }
}
