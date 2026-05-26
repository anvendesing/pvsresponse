using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using PvsCommerce.Mobile.Models;

namespace PvsCommerce.Mobile.Services;

public sealed class CartService : ObservableObject
{
    private const string FileName = "pv_cart_v1.json";
    private readonly string _path;

    public ObservableCollection<CartLine> Lines { get; } = new();

    private double _subTotal;
    public double SubTotal { get => _subTotal; private set => SetProperty(ref _subTotal, value); }

    private int _count;
    public int Count { get => _count; private set => SetProperty(ref _count, value); }

    private static string GetDataDir()
    {
        var d = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(d)) d = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        return Path.Combine(d, "PvsCommerce");
    }

    public CartService()
    {
        _path = Path.Combine(GetDataDir(), FileName);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var json = await File.ReadAllTextAsync(_path);
            var saved = JsonSerializer.Deserialize(json, AppJsonContext.Default.ListCartLine);
            if (saved is null) return;
            foreach (var l in saved) Lines.Add(l);
            Recalc();
        }
        catch { /* corrupt file - start fresh */ }
    }

    private async Task SaveAsync()
    {
        try
        {
            var json = JsonSerializer.Serialize(Lines.ToList(), AppJsonContext.Default.ListCartLine);
            await File.WriteAllTextAsync(_path, json);
        }
        catch { }
    }

    public async Task AddAsync(CatalogProduct product, CatalogVariant? variant, int qty = 1)
    {
        var key = variant?.Id ?? product.Id;
        var existing = Lines.FirstOrDefault(l => l.LineKey == key);
        var available = variant?.StockOnHand ?? product.StockOnHand;
        if (existing is not null)
        {
            existing.Qty = Math.Min(existing.Qty + qty, available);
            // Force UI update by re-inserting at same index
            var idx = Lines.IndexOf(existing);
            Lines[idx] = existing;
        }
        else
        {
            Lines.Add(new CartLine
            {
                ProductId   = product.Id,
                ProductSku  = product.Sku,
                ProductName = product.Name,
                VariantId   = variant?.Id,
                VariantSku  = variant?.Sku,
                VariantSize = variant?.Size,
                Qty         = Math.Min(qty, available),
                Rate        = variant?.Price ?? product.SellingPrice,
                Available   = available,
                PackagingHint = PackagingFromName(product.Name),
            });
        }
        Recalc();
        await SaveAsync();
    }

    public async Task SetQtyAsync(string lineKey, int qty)
    {
        var line = Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        if (qty <= 0) { Lines.Remove(line); }
        else { line.Qty = Math.Min(qty, line.Available); var i = Lines.IndexOf(line); Lines[i] = line; }
        Recalc();
        await SaveAsync();
    }

    public async Task RemoveAsync(string lineKey)
    {
        var line = Lines.FirstOrDefault(l => l.LineKey == lineKey);
        if (line is null) return;
        Lines.Remove(line);
        Recalc();
        await SaveAsync();
    }

    public async Task ClearAsync()
    {
        Lines.Clear();
        Recalc();
        await SaveAsync();
    }

    private void Recalc()
    {
        SubTotal = Lines.Sum(l => l.LineTotal);
        Count    = Lines.Sum(l => l.Qty);
    }

    private static string PackagingFromName(string name)
    {
        var n = name.ToLowerInvariant();
        if (n.Contains("oil") || n.Contains("ghee")) return "bottle-oil";
        if (n.Contains("soap"))  return "soap-pack";
        if (n.Contains("combo")) return "combo-bags";
        return "craft-bag";
    }
}
