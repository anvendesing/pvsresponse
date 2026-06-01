using System;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace NovaErp.ViewModels;

public partial class LoginViewModel : ViewModelBase
{
    private readonly MainViewModel _root;

    [ObservableProperty]
    private string _username = "arjun.patel";

    [ObservableProperty]
    private string _password = "nova1234";

    [ObservableProperty]
    private string _pin = "";

    [ObservableProperty]
    private string _error = "";

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private bool _usePin;

    public LoginViewModel(MainViewModel root)
    {
        _root = root;
    }

    [RelayCommand]
    public async Task SignInAsync()
    {
        Busy = true;
        Error = "";
        try
        {
            var res = UsePin
                ? await _root.Api.PinLoginAsync(Username, Pin)
                : await _root.Api.LoginAsync(Username, Password);
            _root.OnLoggedIn(res.User);
        }
        catch (Exception e)
        {
            Error = e.Message;
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    public void ToggleMode() => UsePin = !UsePin;

    [RelayCommand]
    public void TapPin(string n)
    {
        if (Pin.Length < 6) Pin += n;
        if (Pin.Length == 6) _ = SignInAsync();
    }

    [RelayCommand]
    public void ClearPin() => Pin = "";

    [RelayCommand]
    public void BackspacePin()
    {
        if (Pin.Length > 0) Pin = Pin.Substring(0, Pin.Length - 1);
    }
}
