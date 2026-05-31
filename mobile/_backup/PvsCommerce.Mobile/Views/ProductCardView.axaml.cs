using Avalonia.Controls;
using Avalonia.Input;
using PvsCommerce.Mobile.Services;
using PvsCommerce.Mobile.ViewModels;

namespace PvsCommerce.Mobile.Views;

public partial class ProductCardView : UserControl
{
    public ProductCardView() => InitializeComponent();

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (DataContext is not ProductCardViewModel vm) return;
        var nav  = App.Services.GetRequiredService<NavigationService>();
        var pdpVm = App.Services.GetRequiredService<ProductDetailViewModel>();
        nav.NavigateTo(pdpVm);
        _ = pdpVm.LoadAsync(vm.Product.Id);
    }
}
