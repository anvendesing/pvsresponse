using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class ProductDetailViewModel : ViewModelBase
{
    private readonly ApiClient _api;
    private readonly CatalogService _catalog;
    private readonly CartService _cart;
    private readonly WishlistService _wishlist;
    private readonly NavigationService _nav;

    public ProductDetailViewModel(ApiClient api, CatalogService catalog,
        CartService cart, WishlistService wishlist, NavigationService nav)
    {
        _api = api; _catalog = catalog; _cart = cart; _wishlist = wishlist; _nav = nav;
        VariantChips = new ObservableCollection<VariantChipVm>();
        Related = new ObservableCollection<ProductCardViewModel>();
    }

    [ObservableProperty] private bool _isLoading = true;
    [ObservableProperty] private bool _hasError;
    [ObservableProperty] private string _productName = "";
    [ObservableProperty] private string _sku = "";
    [ObservableProperty] private string _category = "";
    [ObservableProperty] private string _priceFormatted = "";
    [ObservableProperty] private string _uom = "";
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string _ingredients = "";
    [ObservableProperty] private bool _isInStock = true;
    [ObservableProperty] private string _stockLabel = "In Stock";
    [ObservableProperty] private bool _isWished;
    [ObservableProperty] private string? _imageUrl;
    [ObservableProperty] private int _qty = 1;
    [ObservableProperty] private int _maxQty = 99;
    [ObservableProperty] private string _activeTab = "description";
    [ObservableProperty] private string _categoryId = "";
    [ObservableProperty] private string _categoryName = "";

    private ProductDetail? _product;
    private CatalogVariant? _selectedVariant;
    private string _wishKey = "";

    public ObservableCollection<VariantChipVm> VariantChips { get; }
    public ObservableCollection<ProductCardViewModel> Related { get; }

    public async Task LoadAsync(string productId)
    {
        IsLoading = true; HasError = false; Qty = 1;
        try
        {
            _product = await _api.GetProductAsync(productId);
            if (_product is null) { HasError = true; return; }

            ProductName = _product.Name;
            Sku = _product.Sku;
            Category = _product.Category;
            ImageUrl = _catalog.ResolveImageUrl(_product.ImageUrl);
            CategoryId = CategoryRegistry.BucketFor(_product.Category, _product.Name);
            CategoryName = CategoryRegistry.GetById(CategoryId)?.Name ?? _product.Category;

            Description = _product.Description
                ?? $"{_product.Name} is a premium natural product from Prakruthivanam. Hand-picked and farm-direct, it preserves the goodness of nature.";
            Ingredients = _product.Ingredients
                ?? $"100% natural {_product.Name.ToLowerInvariant()}. No artificial additives or preservatives.";

            VariantChips.Clear();
            foreach (var v in _product.Variants)
                VariantChips.Add(new VariantChipVm(v));

            _selectedVariant = _product.Variants.FirstOrDefault();
            _wishKey = _selectedVariant?.Id ?? _product.Id;
            RefreshVariantDeps();

            // Related products from same category
            var all = await _catalog.EnsureLoadedAsync();
            Related.Clear();
            foreach (var p in all
                .Where(p => CategoryRegistry.BucketFor(p.Category, p.Name) == CategoryId && p.Id != productId)
                .Take(4))
                Related.Add(new ProductCardViewModel(p, _catalog));
        }
        catch { HasError = true; }
        finally { IsLoading = false; }
    }

    private void RefreshVariantDeps()
    {
        if (_product is null) return;
        var v = _selectedVariant;
        var stock = v?.StockOnHand ?? _product.StockOnHand;
        var price = v?.Price ?? _product.SellingPrice;
        Sku = v?.Sku ?? _product.Sku;
        Uom = v?.Uom ?? _product.Uom ?? "";
        PriceFormatted = "₹" + price.ToString("N0", CultureInfo.GetCultureInfo("en-IN"));
        IsInStock = stock > 0;
        MaxQty = stock;
        StockLabel = stock <= 0 ? "Out of stock" : stock <= 5 ? $"Only {stock} left!" : "In stock";
        IsWished = _wishlist.Has(_wishKey);
        Qty = 1;
    }

    [RelayCommand]
    private void SelectVariant(VariantChipVm chip)
    {
        if (_product is null) return;
        _selectedVariant = _product.Variants.FirstOrDefault(v => v.Id == chip.Id);
        _wishKey = _selectedVariant?.Id ?? _product.Id;
        foreach (var c in VariantChips) c.IsSelected = c.Id == chip.Id;
        RefreshVariantDeps();
    }

    [RelayCommand]
    private void IncQty() { if (Qty < MaxQty) Qty++; }

    [RelayCommand]
    private void DecQty() { if (Qty > 1) Qty--; }

    [RelayCommand]
    private async System.Threading.Tasks.Task AddToCartAsync()
    {
        if (_product is null || !IsInStock) return;
        await _cart.AddAsync(_product, _selectedVariant, Qty);
        var cartVm = App.Services.GetRequiredService<CartViewModel>();
        _nav.NavigateTo(cartVm);
    }

    [RelayCommand]
    private void ToggleWishlist()
    {
        _wishlist.Toggle(_wishKey);
        IsWished = _wishlist.Has(_wishKey);
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private void GoBack() => _nav.GoBack();

    [RelayCommand]
    private void OpenRelated(ProductCardViewModel vm)
    {
        _ = LoadAsync(vm.Product.Id);
    }
}

public partial class VariantChipVm : ObservableObject
{
    public VariantChipVm(CatalogVariant v) { Id = v.Id; Label = v.Size ?? v.Sku; IsInStock = v.StockOnHand > 0; }
    public string Id { get; }
    public string Label { get; }
    public bool IsInStock { get; }
    [ObservableProperty] private bool _isSelected;
}
