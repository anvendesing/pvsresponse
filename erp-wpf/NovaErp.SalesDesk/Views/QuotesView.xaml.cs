using System.Windows.Controls;
using System.Windows.Input;
using NovaErp.SalesDesk.ViewModels;

namespace NovaErp.SalesDesk.Views;

public partial class QuotesView : UserControl
{
    public QuotesView() => InitializeComponent();

    private QuotesViewModel Vm => (QuotesViewModel)DataContext;

    private void Grid_OnOpen(object sender, MouseButtonEventArgs e) => Vm.OpenSelectedCommand.Execute(null);

    private void Grid_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { Vm.OpenSelectedCommand.Execute(null); e.Handled = true; }
    }
}
