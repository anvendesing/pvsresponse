using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using NovaErp.ViewModels;
using NovaErp.Views;

namespace NovaErp;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        var vm = new MainViewModel();

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow { DataContext = vm };
        }
        else if (ApplicationLifetime is ISingleViewApplicationLifetime single)
        {
            // Mobile / browser (Android, iOS, WebAssembly)
            single.MainView = new MobileMainView { DataContext = vm };
        }

        base.OnFrameworkInitializationCompleted();
    }
}
