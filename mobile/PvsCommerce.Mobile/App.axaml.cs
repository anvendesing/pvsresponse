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

        // Disk-cached web image loader for product photos. Use LocalAppData
        // because AppContext.BaseDirectory is empty on Android.
        var appData = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(appData))
            appData = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        var cacheDir = Path.Combine(appData, "image-cache");
        Directory.CreateDirectory(cacheDir);
        ImageLoader.AsyncImageLoader = new DiskCachedWebImageLoader(cacheDir);

        // MainViewModel is constructed first; the per-tab view-models are
        // built afterwards (they need a back-reference to the shell).
        var main = Services.GetRequiredService<MainViewModel>();
        main.Shop     = Services.GetRequiredService<ShopViewModel>();
        main.Explore  = Services.GetRequiredService<ExploreViewModel>();
        main.CartTab  = Services.GetRequiredService<CartViewModel>();
        main.Profile  = Services.GetRequiredService<ProfileViewModel>();
        main.AuthTab  = Services.GetRequiredService<AuthViewModel>();
        main.Checkout = Services.GetRequiredService<CheckoutViewModel>();
        main.Tracker  = Services.GetRequiredService<TrackerViewModel>();

        // Kick off the initial catalog fetch so the Shop tab is ready.
        _ = main.Shop.LoadAsync();

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.MainWindow = new MainWindow { DataContext = main };
        else if (ApplicationLifetime is ISingleViewApplicationLifetime sv)
            sv.MainView = new MainView { DataContext = main };

        base.OnFrameworkInitializationCompleted();
    }

    private static IServiceProvider ConfigureServices()
    {
        var sc = new ServiceCollection();
        sc.AddSingleton<AppConfig>();
        sc.AddSingleton<HttpClient>();
        sc.AddSingleton<ApiClient>();
        sc.AddSingleton<CatalogService>();
        sc.AddSingleton<CartService>();
        sc.AddSingleton<AuthService>();
        sc.AddSingleton<WishlistService>();

        sc.AddSingleton<MainViewModel>();
        sc.AddSingleton<ShopViewModel>();
        sc.AddSingleton<ExploreViewModel>();
        sc.AddSingleton<CartViewModel>();
        sc.AddSingleton<ProfileViewModel>();
        sc.AddSingleton<AuthViewModel>();
        sc.AddSingleton<CheckoutViewModel>();
        sc.AddSingleton<TrackerViewModel>();
        return sc.BuildServiceProvider();
    }
}

public static class ServiceProviderExtensions
{
    public static T GetRequiredService<T>(this IServiceProvider sp) where T : notnull
        => (T)sp.GetService(typeof(T))!;
}
