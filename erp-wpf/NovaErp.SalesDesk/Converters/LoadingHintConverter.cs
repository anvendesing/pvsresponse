using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace NovaErp.SalesDesk.Converters;

public sealed class LoadingHintConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is true ? "Loading statement…" : "";

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
