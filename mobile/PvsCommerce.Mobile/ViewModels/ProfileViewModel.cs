using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class ProfileViewModel : ViewModelBase
{
    public AuthService Auth { get; }
    public WishlistService Wishlist { get; }
    public CartService Cart { get; }

    private readonly MainViewModel _main;

    public ProfileViewModel(AuthService auth, WishlistService wishlist, CartService cart, MainViewModel main)
    {
        Auth = auth; Wishlist = wishlist; Cart = cart; _main = main;
        Auth.PropertyChanged += (_, __) =>
        {
            OnPropertyChanged(nameof(GreetText));
            OnPropertyChanged(nameof(AddressText));
        };
    }

    [ObservableProperty] private string _activeSubTab = "orders";
    [ObservableProperty] private int _ordersCount;
    [ObservableProperty] private int _wishlistCount;
    [ObservableProperty] private int _savedAmount;

    public string GreetText
        => Auth.IsAuthed ? $"Namaste, {Auth.User!.Name.Split(' ')[0]}!" : "Namaste, Guest!";

    public string AddressText
        => Auth.IsAuthed ? "Add your shipping destination from the dashboard." : "Not defined yet. Log in to sync address.";

    [RelayCommand] private void ShowOrders()    => ActiveSubTab = "orders";
    [RelayCommand] private void ShowWishlist()  => ActiveSubTab = "wishlist";
    [RelayCommand] private void ShowAddresses() => ActiveSubTab = "addresses";

    [RelayCommand]
    private void GoSignIn() => _main.SwitchTab("auth");

    [RelayCommand]
    private void SignOut()
    {
        Auth.SignOut();
        OnPropertyChanged(nameof(GreetText));
        OnPropertyChanged(nameof(AddressText));
    }
}
