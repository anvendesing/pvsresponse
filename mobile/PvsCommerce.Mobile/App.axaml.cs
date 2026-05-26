using System;
using System.IO;
using System.Net.Http;
using AsyncImageLoader;
using AsyncImageLoader.Loaders;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.DependencyInjection;
using PvsCommerce.Mobile.Services;
using PvsCommerce.Mobile.ViewModels;
using PvsCommerce.Mobile.Views;

namespace PvsCommerce.Mobile;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        Services = ConfigureServices();

        // DiskCachedWebImageLoader gives us RAM + disk LRU cache.
        // AppContext.BaseDirectory is empty on Android — use LocalApplicationData
        // which resolves to the app's private files directory on every platform.
        var localAppData = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(localAppData))
            localAppData = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        var cacheDir = Path.Combine(localAppData, "image-cache");
        Directory.CreateDirectory(cacheDir);
        ImageLoader.AsyncImageLoader = new DiskCachedWebImageLoader(cacheDir);

        var mainVm = Services.GetRequiredService<MainViewModel>();

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.MainWindow = new MainWindow { DataContext = mainVm };
        else if (ApplicationLifetime is ISingleViewApplicationLifetime sv)
            sv.MainView = new MainView { DataContext = mainVm };

        base.OnFrameworkInitializationCompleted();
    }

    private static IServiceProvider ConfigureServices()
    {
        var sc = new ServiceCollection();

        // Infrastructure
        sc.AddSingleton<AppConfig>();
        sc.AddSingleton<HttpClient>();
        sc.AddSingleton<ApiClient>();
        sc.AddSingleton<CatalogService>();
        sc.AddSingleton<NavigationService>();

        // State services (persisted to LocalApplicationData/PvsCommerce/)
        sc.AddSingleton<CartService>();
        sc.AddSingleton<AuthService>();
        sc.AddSingleton<WishlistService>();

        // View-models (singleton so navigating back doesn't reset state)
        sc.AddSingleton<HomeViewModel>();
        sc.AddSingleton<CategoryViewModel>();
        sc.AddSingleton<ProductDetailViewModel>();
        sc.AddSingleton<CartViewModel>();
        sc.AddSingleton<CheckoutViewModel>();
        sc.AddSingleton<LoginViewModel>();
        sc.AddSingleton<AccountViewModel>();
        sc.AddSingleton<SettingsViewModel>();
        sc.AddSingleton<MainViewModel>();

        return sc.BuildServiceProvider();
    }
}

// Extension helper so view-models can resolve dependencies without injecting
// the full IServiceProvider (keeps constructors lean).
public static class ServiceProviderExtensions
{
    public static T GetRequiredService<T>(this IServiceProvider sp) where T : notnull
        => (T)sp.GetService(typeof(T))!;
}
