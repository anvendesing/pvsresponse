using System.Windows.Controls;
using System.Windows.Input;
using NovaErp.SalesDesk.Models;
using NovaErp.SalesDesk.ViewModels;

namespace NovaErp.SalesDesk.Views;

public partial class QuoteEditorView : UserControl
{
    public QuoteEditorView()
    {
        InitializeComponent();
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter && DataContext is QuoteEditorViewModel vm)
            {
                vm.AddLineCommand.Execute(null);
                e.Handled = true;
            }
        };
    }

    private QuoteEditorViewModel Vm => (QuoteEditorViewModel)DataContext;

    private void CustomerList_OnPick(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBox lb && lb.SelectedItem is CustomerRow c)
            Vm.PickCustomerCommand.Execute(c);
    }

    private void ProductList_OnPick(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBox lb && lb.SelectedItem is Product p)
            Vm.PickProductCommand.Execute(p);
    }
}
