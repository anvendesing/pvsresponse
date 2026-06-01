using System;
using System.Globalization;
using Avalonia.Data.Converters;

namespace NovaErp.Views;

/// <summary>Returns true if the bound string equals the converter parameter.</summary>
public class StringEqualsConverter : IValueConverter
{
    public static readonly StringEqualsConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var s = value?.ToString();
        var p = parameter?.ToString();
        return string.Equals(s, p, StringComparison.OrdinalIgnoreCase);
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

/// <summary>Inverts a boolean.</summary>
public class InvertBoolConverter : IValueConverter
{
    public static readonly InvertBoolConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is bool b ? !b : true;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is bool b ? !b : true;
}

/// <summary>True when length of the string is at least the parameter (int).</summary>
public class StringMinLengthConverter : IValueConverter
{
    public static readonly StringMinLengthConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var s = value?.ToString() ?? "";
        if (!int.TryParse(parameter?.ToString(), out var n)) n = 1;
        return s.Length >= n;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
