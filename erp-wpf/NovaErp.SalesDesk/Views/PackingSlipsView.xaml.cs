using System.Windows.Controls;
using System.Windows.Input;
using NovaErp.SalesDesk.ViewModels;

namespace NovaErp.SalesDesk.Views;

public partial class PackingSlipsView : UserControl
{
    public PackingSlipsView() => InitializeComponent();

    private PackingSlipsViewModel Vm => (PackingSlipsViewModel)DataContext;

    private void Grid_OnOpen(object sender, MouseButtonEventArgs e) => Vm.OpenSelectedCommand.Execute(null);

    private void Grid_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { Vm.OpenSelectedCommand.Execute(null); e.Handled = true; }
    }
}
