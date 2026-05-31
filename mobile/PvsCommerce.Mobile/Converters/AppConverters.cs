using System;
using System.Globalization;
using Avalonia.Data.Converters;

namespace PvsCommerce.Mobile.Converters;

// Returns true when bound int > 0 (used for cart count badge visibility,
// order count, etc.).
public sealed class GreaterThanZeroConverter : IValueConverter
{
    public static readonly GreaterThanZeroConverter Instance = new();
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value switch
        {
            int i    => i > 0,
            long l   => l > 0,
            double d => d > 0,
            _ => false,
        };
    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

// Compares the bound value against ConverterParameter using string equality.
// Used to drive "active" visual state on tab pills / nav buttons by binding
// to the active tab/category/method id.
public sealed class EqualsParamConverter : IValueConverter
{
    public static readonly EqualsParamConverter Instance = new();
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => string.Equals(value?.ToString(), parameter?.ToString(), StringComparison.Ordinal);
    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

// Format a double price as ₹1,234/-.
public sealed class IndianRupeeConverter : IValueConverter
{
    public static readonly IndianRupeeConverter Instance = new();
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is null) return "";
        var d = System.Convert.ToDouble(value, CultureInfo.InvariantCulture);
        return "₹" + d.ToString("N0", CultureInfo.GetCultureInfo("en-IN")) + "/-";
    }
    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

// Maps a category id ("oils", "grains", etc.) to its bundled PNG resource.
public sealed class CategoryImageConverter : IValueConverter
{
    public static readonly CategoryImageConverter Instance = new();
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => $"avares://PvsCommerce.Mobile/Assets/Categories/category_{value}.png";
    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

// Convert a hex string like "#FCE7AD" into a SolidColorBrush. Used for the
// per-product pouch tint where the colour is computed in the VM.
public sealed class HexBrushConverter : IValueConverter
{
    public static readonly HexBrushConverter Instance = new();
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var s = value as string;
        if (string.IsNullOrEmpty(s)) return Avalonia.Media.Brushes.Transparent;
        try { return new Avalonia.Media.SolidColorBrush(Avalonia.Media.Color.Parse(s)); }
        catch { return Avalonia.Media.Brushes.Transparent; }
    }
    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
