using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class LoginViewModel : ViewModelBase
{
    private readonly AuthService _auth;
    private readonly NavigationService _nav;

    public LoginViewModel(AuthService auth, NavigationService nav)
    {
        _auth = auth;
        _nav = nav;
    }

    [ObservableProperty] private string _name  = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _phone = "";
    [ObservableProperty] private string? _errorMessage;

    [RelayCommand]
    private void SignIn()
    {
        ErrorMessage = null;
        if (string.IsNullOrWhiteSpace(Name) || string.IsNullOrWhiteSpace(Email)
            || string.IsNullOrWhiteSpace(Phone))
        {
            ErrorMessage = "Please fill in all fields.";
            return;
        }
        _auth.SignIn(new AuthUser { Name = Name.Trim(), Email = Email.Trim(), Phone = Phone.Trim() });
        _nav.GoBack();
    }

    [RelayCommand]
    private void GoBack() => _nav.GoBack();
}
