using System.Windows;
using System.Windows.Input;
using NovaErp.SalesDesk.ViewModels;

namespace NovaErp.SalesDesk.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm;

    public MainWindow(MainViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        DataContext = vm;
        Loaded += async (_, _) =>
        {
            await _vm.Quotes.LoadAsync();
            _ = _vm.Customers.LoadAsync();
            _ = Task.Run(async () => await _vm.PreloadCatalogAsync());
            Focus();
        };
        KeyDown += OnKeyDown;
    }

    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers == ModifierKeys.Control)
        {
            switch (e.Key)
            {
                case Key.D1: _vm.ShowQuotesCommand.Execute(null); e.Handled = true; break;
                case Key.D2: _vm.ShowSalesOrdersCommand.Execute(null); e.Handled = true; break;
                case Key.D3: _vm.ShowPickListsCommand.Execute(null); e.Handled = true; break;
                case Key.D4: _vm.ShowPackingSlipsCommand.Execute(null); e.Handled = true; break;
                case Key.D5: _vm.ShowCustomersCommand.Execute(null); e.Handled = true; break;
                case Key.N: _vm.NewQuoteCommand.Execute(null); e.Handled = true; break;
                case Key.S:
                    if (_vm.Current is QuoteEditorViewModel q) q.SaveCommand.Execute(null);
                    e.Handled = true;
                    break;
                case Key.K:
                    _vm.ShowCustomersCommand.Execute(null);
                    e.Handled = true;
                    break;
                case Key.Enter:
                    if (_vm.Current is QuoteEditorViewModel qc)
                        qc.SubmitCommand.Execute(null);
                    e.Handled = true;
                    break;
            }
        }

        if (Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.O
            && _vm.Current is QuoteEditorViewModel qConv)
        {
            qConv.ConvertToSalesOrderCommand.Execute(null);
            e.Handled = true;
        }

        if (e.Key == Key.F3 && _vm.Current is not QuoteEditorViewModel)
        {
            _vm.NewQuoteCommand.Execute(null);
            e.Handled = true;
        }
        if (e.Key == Key.F5)
        {
            _vm.RefreshCurrentCommand.Execute(null);
            e.Handled = true;
        }
        if (e.Key == Key.Escape)
        {
            _vm.GoBackCommand.Execute(null);
            e.Handled = true;
        }
        if (e.Key == Key.F10)
        {
            if (_vm.Current is PickListEditorViewModel pl) pl.CompleteCommand.Execute(null);
            if (_vm.Current is PackingSlipEditorViewModel ps) ps.PackCommand.Execute(null);
            e.Handled = true;
        }
    }
}
