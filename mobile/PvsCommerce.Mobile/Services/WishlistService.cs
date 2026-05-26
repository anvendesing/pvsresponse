using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;

namespace PvsCommerce.Mobile.Services;

public sealed class WishlistService : ObservableObject
{
    private const string FileName = "pv_wishlist_v1.json";
    private readonly string _path;
    private HashSet<string> _ids = new(StringComparer.Ordinal);

    private static string GetDataDir()
    {
        var d = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(d)) d = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        return Path.Combine(d, "PvsCommerce");
    }

    public WishlistService()
    {
        _path = Path.Combine(GetDataDir(), FileName);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        Load();
    }

    public bool Has(string id) => _ids.Contains(id);

    public void Toggle(string id)
    {
        if (!_ids.Remove(id)) _ids.Add(id);
        OnPropertyChanged(nameof(Has));
        Save();
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var json = File.ReadAllText(_path);
            var list = JsonSerializer.Deserialize<List<string>>(json);
            if (list is not null) _ids = new HashSet<string>(list, StringComparer.Ordinal);
        }
        catch { }
    }

    private void Save()
    {
        try
        {
            File.WriteAllText(_path,
                JsonSerializer.Serialize(new List<string>(_ids)));
        }
        catch { }
    }
}
