using System;
using System.Globalization;
using Avalonia;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace PvsCommerce.Mobile.Converters;

// Tab border: bottom-border-only (0,0,0,2) when active, else 0
public sealed class TabBorderConverter : IValueConverter
{
    public static readonly TabBorderConverter Instance = new();
    public object Convert(object? value, Type t, object? p, CultureInfo c)
        => (string?)value == (string?)p ? new Thickness(0, 0, 0, 2) : new Thickness(0);
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Tab visible: true when active tab == parameter
public sealed class TabVisibleConverter : IValueConverter
{
    public static readonly TabVisibleConverter Instance = new();
    public object Convert(object? value, Type t, object? p, CultureInfo c)
        => (string?)value == (string?)p;
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Wishlist emoji: ❤️ when wished, 🤍 otherwise
public sealed class WishlistEmojiConverter : IValueConverter
{
    public static readonly WishlistEmojiConverter Instance = new();
    public object Convert(object? value, Type t, object? p, CultureInfo c)
        => value is true ? "❤️" : "🤍";
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Chip background: forest-soft when selected, light when not
public sealed class SelectedChipBgConverter : IValueConverter
{
    public static readonly SelectedChipBgConverter Instance = new();
    public object? Convert(object? value, Type t, object? p, CultureInfo c)
        => value is true
            ? new SolidColorBrush(Color.Parse("#385F1C"))
            : new SolidColorBrush(Color.Parse("#FAFAF9"));
    public object ConvertBack(object? v, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Chip foreground: white when selected, dark otherwise
public sealed class SelectedChipFgConverter : IValueConverter
{
    public static readonly SelectedChipFgConverter Instance = new();
    public object? Convert(object? value, Type t, object? p, CultureInfo c)
        => value is true
            ? new SolidColorBrush(Colors.White)
            : new SolidColorBrush(Color.Parse("#22251F"));
    public object ConvertBack(object? v, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// InrConverter: double → "₹1,234"
public sealed class InrConverter : IValueConverter
{
    public static readonly InrConverter Instance = new();
    private static readonly CultureInfo En = CultureInfo.GetCultureInfo("en-IN");
    public object? Convert(object? value, Type t, object? p, CultureInfo c)
        => value is double d ? "₹" + d.ToString("N0", En) : "₹0";
    public object ConvertBack(object? v, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}
