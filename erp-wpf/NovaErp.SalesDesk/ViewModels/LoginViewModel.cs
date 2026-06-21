using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.SalesDesk.Services;

namespace NovaErp.SalesDesk.ViewModels;

public partial class LoginViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly AppSession _session;

    public LoginViewModel(ApiClient api, AppSession session)
    {
        _api = api;
        _session = session;
        _ = RefreshHealthAsync();
    }

    [ObservableProperty] private string _username = "arjun.patel";
    [ObservableProperty] private string _password = "nova1234";
    [ObservableProperty] private bool _backendOnline;
    [ObservableProperty] private bool _showPassword;

    public event Action? LoginSucceeded;

    [RelayCommand]
    private async Task RefreshHealthAsync()
    {
        BackendOnline = await _api.HealthCheckAsync();
    }

    [RelayCommand]
    private async Task LoginAsync()
    {
        await RunAsync(async () =>
        {
            if (string.IsNullOrWhiteSpace(Username) || string.IsNullOrEmpty(Password))
                throw new InvalidOperationException("Enter username and password.");
            await _api.LoginAsync(Username.Trim(), Password);
            LoginSucceeded?.Invoke();
        }, "Signing in…");
    }
}
