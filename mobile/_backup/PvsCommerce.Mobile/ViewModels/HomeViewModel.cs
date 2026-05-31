using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class HomeViewModel : ViewModelBase
{
    private readonly CatalogService _catalog;
    private readonly NavigationService _nav;
    private readonly AppConfig _config;

    public HomeViewModel(CatalogService catalog, NavigationService nav, AppConfig config)
    {
        _catalog = catalog;
        _nav = nav;
        _config = config;
        BestSellers = new ObservableCollection<ProductCardViewModel>();
        Combos = new ObservableCollection<ProductCardViewModel>();
    }

    [ObservableProperty] private bool _isLoading = true;
    [ObservableProperty] private string? _errorMessage;

    // Surfaced to the diagnostic footer on HomeView so users can confirm
    // which backend they're hitting and edit it via Settings.
    public string ApiBaseUrl => _config.ApiBaseUrl;

    public ObservableCollection<ProductCardViewModel> BestSellers { get; }
    public ObservableCollection<ProductCardViewModel> Combos { get; }

    [RelayCommand]
    public async Task LoadAsync()
    {
        IsLoading = true;
        ErrorMessage = null;
        try
        {
            var products = await _catalog.EnsureLoadedAsync();

            BestSellers.Clear();
            foreach (var p in products.Take(4))
                BestSellers.Add(new ProductCardViewModel(p, _catalog, badge: BadgeFor(p, "best")));

            Combos.Clear();
            var direct = products.Where(p => p.Name.Contains("combo", System.StringComparison.OrdinalIgnoreCase)).ToList();
            var combos = direct.Count >= 4 ? direct.Take(4) : direct.Concat(products.Where(p => !direct.Contains(p))).Take(4);
            foreach (var p in combos)
                Combos.Add(new ProductCardViewModel(p, _catalog, badge: "Combo Save"));
        }
        catch (System.Exception ex)
        {
            ErrorMessage = $"Could not reach {_config.ApiBaseUrl}\n{ex.GetType().Name}: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    private static string BadgeFor(CatalogProduct p, string kind)
    {
        if (kind == "combo") return "Combo Save";
        var n = p.Name.ToLowerInvariant() + " " + p.Category.ToLowerInvariant();
        if (n.Contains("millet")) return "Stone Ground";
        if (n.Contains("oil")) return "Wood Pressed";
        if (n.Contains("soap") || n.Contains("herbal")) return "Herbal";
        if (n.Contains("honey")) return "Forest Honey";
        return "Best Seller";
    }
}
