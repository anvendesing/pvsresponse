using System;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Shell view-model. Owns the active tab (string id), the open/closed state
// for the two modal sheets, and exposes the per-tab view-models so the
// MainView can switch by visibility instead of a content swap. This mirrors
// the HTML mock where every screen lives inside the single phone viewport
// and active tabs simply toggle the .active class.
public partial class MainViewModel : ViewModelBase
{
    public CartService Cart { get; }
    public AuthService Auth { get; }

    public MainViewModel(CartService cart, AuthService auth)
    {
        Cart = cart; Auth = auth;
    }

    // Wired up after construction via App.OnFrameworkInitializationCompleted
    // because each per-tab VM also needs MainViewModel.
    public ShopViewModel?     Shop     { get; set; }
    public ExploreViewModel?  Explore  { get; set; }
    public CartViewModel?     CartTab  { get; set; }
    public ProfileViewModel?  Profile  { get; set; }
    public AuthViewModel?     AuthTab  { get; set; }
    public CheckoutViewModel? Checkout { get; set; }
    public TrackerViewModel?  Tracker  { get; set; }

    [ObservableProperty] private string _activeTab = "shop";

    public bool IsShop    => ActiveTab == "shop";
    public bool IsExplore => ActiveTab == "explore";
    public bool IsCart    => ActiveTab == "cart";
    public bool IsProfile => ActiveTab == "profile";
    public bool IsAuth    => ActiveTab == "auth";

    // Bottom-nav stays hidden when the user is on the auth screen, mirroring
    // the HTML behaviour.
    public bool BottomNavVisible => ActiveTab != "auth";

    partial void OnActiveTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsShop));
        OnPropertyChanged(nameof(IsExplore));
        OnPropertyChanged(nameof(IsCart));
        OnPropertyChanged(nameof(IsProfile));
        OnPropertyChanged(nameof(IsAuth));
        OnPropertyChanged(nameof(BottomNavVisible));
    }

    [RelayCommand]
    public void SwitchTab(string tab)
    {
        if (string.IsNullOrEmpty(tab)) return;
        ActiveTab = tab;
        // Lazy refresh per-tab on switch
        if (tab == "explore") _ = Explore?.LoadAsync();
        if (tab == "shop")    _ = Shop?.LoadAsync();
    }

    public void GoExploreWithCategory(string id)
    {
        Explore?.SetCategory(id);
        SwitchTab("explore");
    }

    public void OpenCheckout() => Checkout?.Open();

    public void OpenTracker(string soNo, string invoice) => Tracker?.Open(invoice);
}
