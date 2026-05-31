using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Sign-in / sign-up tabs. The HTML mockup has OTP and password sub-modes;
// for the real API both forms POST to the storefront mock auth endpoint —
// we accept any well-formed entry as a sign-in here (no backend verification
// yet) since the storefront-mock backend doesn't currently expose auth.
public partial class AuthViewModel : ViewModelBase
{
    private readonly AuthService _auth;
    private readonly MainViewModel _main;

    public AuthViewModel(AuthService auth, MainViewModel main) { _auth = auth; _main = main; }

    [ObservableProperty] private string _activeMode = "signin";
    [ObservableProperty] private string _activeSignInMethod = "otp";

    [ObservableProperty] private string _signInMobile = string.Empty;
    [ObservableProperty] private string _signInOtpCode = string.Empty;
    [ObservableProperty] private string _signInEmail = string.Empty;
    [ObservableProperty] private string _signInPassword = string.Empty;

    [ObservableProperty] private string _signUpName = string.Empty;
    [ObservableProperty] private string _signUpMobile = string.Empty;
    [ObservableProperty] private string _signUpEmail = string.Empty;

    [ObservableProperty] private string? _statusMessage;
    [ObservableProperty] private bool _otpRequested;

    [RelayCommand] private void ShowSignIn() => ActiveMode = "signin";
    [RelayCommand] private void ShowSignUp() => ActiveMode = "signup";
    [RelayCommand] private void UseOtp()      => ActiveSignInMethod = "otp";
    [RelayCommand] private void UsePassword() => ActiveSignInMethod = "pass";

    [RelayCommand]
    private void SignIn()
    {
        if (ActiveSignInMethod == "otp")
        {
            if (!OtpRequested)
            {
                if (SignInMobile.Length < 10) { StatusMessage = "Enter a valid 10-digit mobile number."; return; }
                OtpRequested = true;
                StatusMessage = "OTP sent! Use 123456 to continue.";
                return;
            }
            if (SignInOtpCode != "123456") { StatusMessage = "Invalid OTP. Hint: use 123456."; return; }
            _auth.SignIn(new AuthUser { Name = "Customer", Phone = SignInMobile, Email = "" });
        }
        else
        {
            if (string.IsNullOrWhiteSpace(SignInEmail) || string.IsNullOrWhiteSpace(SignInPassword))
            { StatusMessage = "Enter email and password."; return; }
            _auth.SignIn(new AuthUser { Name = SignInEmail.Split('@')[0], Email = SignInEmail, Phone = "" });
        }
        StatusMessage = "Signed in.";
        _main.SwitchTab("shop");
    }

    [RelayCommand]
    private void SignUp()
    {
        if (string.IsNullOrWhiteSpace(SignUpName) || string.IsNullOrWhiteSpace(SignUpEmail))
        { StatusMessage = "Name and email are required."; return; }
        _auth.SignIn(new AuthUser { Name = SignUpName, Email = SignUpEmail, Phone = SignUpMobile });
        StatusMessage = "Account created.";
        _main.SwitchTab("shop");
    }

    [RelayCommand]
    private void ContinueAsGuest() => _main.SwitchTab("shop");
}
