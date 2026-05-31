using System;
using System.Globalization;
using Avalonia.Data.Converters;

namespace PvsCommerce.Mobile.Converters;

public sealed class PlacingLabelConverter : IValueConverter
{
    public static readonly PlacingLabelConverter Instance = new();
    public object Convert(object? value, Type t, object? p, CultureInfo c)
        => value is true ? "Placing order…" : "Place Order";
    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => throw new NotSupportedException();
}
