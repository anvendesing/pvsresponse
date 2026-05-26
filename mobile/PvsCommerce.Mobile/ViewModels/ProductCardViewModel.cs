using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Wraps a CatalogProduct with the bits the card needs: resolved image URL,
// formatted price, in-stock state, and the optional contextual badge.
public partial class ProductCardViewModel : ObservableObject
{
    public ProductCardViewModel(CatalogProduct product, CatalogService catalog, string? badge = null)
    {
        Product = product;
        Badge = badge;

        var primaryVariant = product.Variants.FirstOrDefault();
        Price = (primaryVariant?.Price ?? product.SellingPrice);
        Uom = primaryVariant?.Uom ?? product.Uom;
        StockOnHand = primaryVariant?.StockOnHand ?? product.StockOnHand;
        ImageUrl = catalog.ResolveImageUrl(product.ImageUrl);
        PackagingHint = PackagingFromName(product.Name);
    }

    public CatalogProduct Product { get; }
    public string? Badge { get; }
    public string Name => Product.Name;
    public string Sku => Product.Sku;
    public double Price { get; }
    public string PriceFormatted => "₹" + Price.ToString("N0", CultureInfo.GetCultureInfo("en-IN"));
    public string? Uom { get; }
    public int StockOnHand { get; }
    public bool IsLowStock => StockOnHand > 0 && StockOnHand <= 5;
    public bool IsOutOfStock => StockOnHand <= 0;
    public string StockLabel => IsOutOfStock ? "Sold out" : IsLowStock ? $"{StockOnHand} left" : "In Stock";
    public string? ImageUrl { get; }
    public string PackagingHint { get; }

    // Mirrors pvsecommerce/src/lib/format.ts packagingFromName - same buckets
    // so the vector packaging art chosen on web and mobile stay consistent.
    private static string PackagingFromName(string name)
    {
        var n = name.ToLowerInvariant();
        if (n.Contains("oil") || n.Contains("ghee")) return "bottle-oil";
        if (n.Contains("soap")) return "soap-pack";
        if (n.Contains("combo")) return "combo-bags";
        return "craft-bag";
    }
}
