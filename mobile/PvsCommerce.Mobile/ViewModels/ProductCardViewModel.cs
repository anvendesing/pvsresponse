using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Wraps a CatalogProduct for the 2-col product card grid used on Shop and
// Explore views. Keeps the bag-tone + tag-line logic mirroring the HTML
// `renderProductCard` switch (oil → cream, combo → tan, default → millet).
public partial class ProductCardViewModel : ObservableObject
{
    private readonly CatalogService _catalog;
    private readonly CartService _cart;
    private readonly WishlistService _wishlist;

    public ProductCardViewModel(
        CatalogProduct product,
        CatalogService catalog,
        CartService cart,
        WishlistService wishlist,
        string? badge = null)
    {
        Product = product;
        _catalog = catalog;
        _cart = cart;
        _wishlist = wishlist;
        Badge = badge ?? "Best Seller";

        var primary = product.Variants.FirstOrDefault();
        Price       = primary?.Price ?? product.SellingPrice;
        WeightLabel = primary?.Size ?? product.Uom ?? "Standard";
        StockOnHand = primary?.StockOnHand ?? product.StockOnHand;
        ImageUrl    = catalog.ResolveImageUrl(product.ImageUrl);

        // Pouch tinting heuristic mirrors HTML mock.
        var n = product.Name.ToLowerInvariant();
        var c = product.Category.ToLowerInvariant();
        if (c.Contains("oil") || n.Contains("oil") || n.Contains("ghee"))
        { PouchColor = "#FCE7AD"; PouchTag = "PURE OIL"; }
        else if (n.Contains("combo"))
        { PouchColor = "#E3C298"; PouchTag = "COMBOS"; }
        else
        { PouchColor = "#D8BC93"; PouchTag = "MILLETS"; }
    }

    public CatalogProduct Product { get; }
    public string Name => Product.Name;
    public string Sku  => Product.Sku;
    public double Price { get; }
    public string PriceFormatted => "₹" + Price.ToString("N0", CultureInfo.GetCultureInfo("en-IN")) + "/-";
    public string WeightLabel { get; }
    public string Badge { get; }
    public int StockOnHand { get; }
    public bool IsOutOfStock => StockOnHand <= 0;
    public string? ImageUrl { get; }
    public string PouchColor { get; }
    public string PouchTag { get; }

    public bool IsWishlisted => _wishlist.Has(Product.Id);

    [RelayCommand]
    private async System.Threading.Tasks.Task AddToCart()
    {
        var primary = Product.Variants.FirstOrDefault();
        await _cart.AddAsync(Product, primary, 1);
    }

    [RelayCommand]
    private void ToggleWishlist()
    {
        _wishlist.Toggle(Product.Id);
        OnPropertyChanged(nameof(IsWishlisted));
    }
}
