using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class CategoryTileViewModel : ObservableObject
{
    public CategoryTileViewModel(CategoryDef def) { Id = def.Id; Name = def.Name; }
    public string Id { get; }
    public string Name { get; }
    [ObservableProperty] private bool _isActive;
}

// Top-level "Shop" tab — the home feed in the HTML mockup. Shows category
// circles, a promo banner, and two product feeds (Best Sellers + Combos).
public partial class ShopViewModel : ViewModelBase
{
    private readonly CatalogService _catalog;
    private readonly CartService _cart;
    private readonly WishlistService _wishlist;
    private readonly MainViewModel _main;

    public ShopViewModel(CatalogService catalog, CartService cart, WishlistService wishlist, MainViewModel main)
    {
        _catalog = catalog; _cart = cart; _wishlist = wishlist; _main = main;

        Categories  = new ObservableCollection<CategoryTileViewModel>(
            CategoryRegistry.All.Select(c => new CategoryTileViewModel(c)));
        BestSellers = new ObservableCollection<ProductCardViewModel>();
        Combos      = new ObservableCollection<ProductCardViewModel>();
    }

    public ObservableCollection<CategoryTileViewModel> Categories { get; }
    public ObservableCollection<ProductCardViewModel> BestSellers { get; }
    public ObservableCollection<ProductCardViewModel> Combos { get; }

    [ObservableProperty] private bool _isLoading = true;
    [ObservableProperty] private string? _errorMessage;

    public string ApiBaseUrl => _catalog.ApiBaseUrl;

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
                BestSellers.Add(new ProductCardViewModel(p, _catalog, _cart, _wishlist, BadgeFor(p)));

            var direct = products.Where(p => p.Name.Contains("combo", System.StringComparison.OrdinalIgnoreCase)).ToList();
            var combos = direct.Count >= 4
                ? direct.Take(4)
                : direct.Concat(products.Where(p => !direct.Contains(p))).Take(4);
            Combos.Clear();
            foreach (var p in combos)
                Combos.Add(new ProductCardViewModel(p, _catalog, _cart, _wishlist, "Combo Save"));
        }
        catch (System.Exception ex)
        {
            ErrorMessage = $"Could not reach {_catalog.ApiBaseUrl}: {ex.GetType().Name}: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void OpenCategory(string id) => _main.GoExploreWithCategory(id);

    [RelayCommand]
    private void GoExplore() => _main.SwitchTab("explore");

    private static string BadgeFor(CatalogProduct p)
    {
        var n = p.Name.ToLowerInvariant() + " " + p.Category.ToLowerInvariant();
        if (n.Contains("oil"))    return "100% Organic";
        if (n.Contains("millet")) return "Best Seller";
        if (n.Contains("honey"))  return "Forest Honey";
        if (n.Contains("soap") || n.Contains("herbal")) return "Herbal";
        return "Best Seller";
    }
}
