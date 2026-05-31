using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Search + category-chip filtered grid. Mirrors the HTML "explore" tab.
public partial class ExploreViewModel : ViewModelBase
{
    private readonly CatalogService _catalog;
    private readonly CartService _cart;
    private readonly WishlistService _wishlist;

    public ExploreViewModel(CatalogService catalog, CartService cart, WishlistService wishlist)
    {
        _catalog = catalog; _cart = cart; _wishlist = wishlist;
        Chips = new ObservableCollection<CategoryTileViewModel>(
            CategoryRegistry.All.Select(c => new CategoryTileViewModel(c) { IsActive = c.Id == "oils" }));
        Products = new ObservableCollection<ProductCardViewModel>();
    }

    public bool IsEmpty => Products.Count == 0;

    public ObservableCollection<CategoryTileViewModel> Chips { get; }
    public ObservableCollection<ProductCardViewModel> Products { get; }

    [ObservableProperty] private string _activeCategoryId = "oils";
    [ObservableProperty] private string _activeCategoryName = "Oils & Oil Seeds";
    [ObservableProperty] private string _searchQuery = string.Empty;
    [ObservableProperty] private string _countLabel = "0 items";
    [ObservableProperty] private bool _isLoading;

    partial void OnSearchQueryChanged(string value) => Refresh();

    public async Task LoadAsync()
    {
        IsLoading = true;
        try { await _catalog.EnsureLoadedAsync(); }
        finally { IsLoading = false; }
        Refresh();
    }

    [RelayCommand]
    private void SelectChip(string id)
    {
        ActiveCategoryId = id;
        ActiveCategoryName = CategoryRegistry.GetById(id)?.Name ?? id;
        foreach (var c in Chips) c.IsActive = c.Id == id;
        Refresh();
    }

    public void SetCategory(string id)
    {
        SelectChip(id);
    }

    private void Refresh()
    {
        var all = _catalog.Products;
        var inCat = all.Where(p => CategoryRegistry.BucketFor(p.Category, p.Name) == ActiveCategoryId);
        if (!string.IsNullOrWhiteSpace(SearchQuery))
        {
            var q = SearchQuery.Trim();
            inCat = inCat.Where(p => p.Name.Contains(q, System.StringComparison.OrdinalIgnoreCase));
        }
        var list = inCat.ToList();
        Products.Clear();
        foreach (var p in list)
            Products.Add(new ProductCardViewModel(p, _catalog, _cart, _wishlist, p.StockOnHand > 0 ? "In Stock" : "Limited"));
        CountLabel = $"{list.Count} items available";
        OnPropertyChanged(nameof(IsEmpty));
    }
}
