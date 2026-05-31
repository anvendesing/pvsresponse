using System;
using System.Globalization;
using Avalonia.Data.Converters;

namespace PvsCommerce.Mobile.Converters;

// Converts int/double → bool: returns true when value > 0.
// Used for the cart badge — only shown when count > 0.
public sealed class GreaterThanZeroConverter : IValueConverter
{
    public static readonly GreaterThanZeroConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is int i && i > 0 || value is double d && d > 0;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
