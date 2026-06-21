using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using NovaErp.SalesDesk.ViewModels;

namespace NovaErp.SalesDesk.Views;

public partial class LoginWindow : Window
{
    private readonly LoginViewModel _vm;

    public LoginWindow(LoginViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        DataContext = vm;
        vm.LoginSucceeded += OnLoginSucceeded;
        Loaded += (_, _) => MoveFocus(new TraversalRequest(FocusNavigationDirection.First));
        KeyDown += OnKeyDown;
    }

    public event Action? Authenticated;

    private void PasswordBox_OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox pb) _vm.Password = pb.Password;
    }

    private async void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && _vm.LoginCommand.CanExecute(null))
        {
            await _vm.LoginCommand.ExecuteAsync(null);
            e.Handled = true;
        }
    }

    private void OnLoginSucceeded() => Authenticated?.Invoke();
}
