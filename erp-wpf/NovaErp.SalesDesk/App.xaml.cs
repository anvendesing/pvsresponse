using System.Windows;
using Microsoft.Extensions.Configuration;
using NovaErp.SalesDesk.Services;
using NovaErp.SalesDesk.ViewModels;
using NovaErp.SalesDesk.Views;

namespace NovaErp.SalesDesk;

public partial class App : Application
{
    private AppSession _session = null!;
    private ApiClient _api = null!;
    private CatalogCache _cache = null!;
    private LoginWindow? _login;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        _session = new AppSession();
        _api = new ApiClient(config, _session);
        _cache = new CatalogCache(_api);

        var quotes = new QuotesViewModel(_api);
        var salesOrders = new SalesOrdersViewModel(_api);
        var pickLists = new PickListsViewModel(_api);
        var packingSlips = new PackingSlipsViewModel(_api);
        var customers = new CustomersViewModel(_api, _cache);
        var main = new MainViewModel(_api, _session, _cache, quotes, salesOrders, pickLists, packingSlips, customers);

        var loginVm = new LoginViewModel(_api, _session);
        _login = new LoginWindow(loginVm);
        _login.Authenticated += () =>
        {
            var mainWindow = new MainWindow(main);
            mainWindow.Show();
            _login.Close();
            MainWindow = mainWindow;
        };
        _login.Show();
    }
}
