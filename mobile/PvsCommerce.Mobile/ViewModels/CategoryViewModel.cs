using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Models;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

public partial class CategoryViewModel : ViewModelBase
{
    private readonly CatalogService _catalog;
    private readonly NavigationService _nav;

    public CategoryViewModel(CatalogService catalog, NavigationService nav)
    {
        _catalog = catalog;
        _nav = nav;
        Products = new ObservableCollection<ProductCardViewModel>();
    }

    [ObservableProperty] private string _categoryId = "";
    [ObservableProperty] private string _categoryName = "";
    [ObservableProperty] private bool _isLoading = true;
    [ObservableProperty] private string? _errorMessage;

    public ObservableCollection<ProductCardViewModel> Products { get; }

    public async Task LoadAsync(string categoryId)
    {
        CategoryId = categoryId;
        CategoryName = CategoryRegistry.GetById(categoryId)?.Name ?? categoryId;
        IsLoading = true;
        ErrorMessage = null;
        try
        {
            var all = await _catalog.EnsureLoadedAsync();
            Products.Clear();
            foreach (var p in all.Where(p => CategoryRegistry.BucketFor(p.Category, p.Name) == categoryId))
                Products.Add(new ProductCardViewModel(p, _catalog));
        }
        catch (System.Exception ex) { ErrorMessage = ex.Message; }
        finally { IsLoading = false; }
    }

    [RelayCommand]
    private void OpenProduct(ProductCardViewModel vm)
    {
        var pdp = App.Services.GetRequiredService<ProductDetailViewModel>();
        _nav.NavigateTo(pdp);
        _ = pdp.LoadAsync(vm.Product.Id);
    }

    [RelayCommand]
    private void GoBack() => _nav.GoBack();
}
