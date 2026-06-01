using Avalonia.Controls;
using Avalonia.Input;
using NovaErp.ViewModels;

namespace NovaErp.Views;

public partial class WarehouseStationView : UserControl
{
    public WarehouseStationView()
    {
        InitializeComponent();
    }

    private void ScanKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && DataContext is WarehouseStationViewModel vm)
        {
            _ = vm.ScanAsync();
            e.Handled = true;
        }
    }
}
