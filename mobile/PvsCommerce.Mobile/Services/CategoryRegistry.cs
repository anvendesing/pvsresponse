using System;
using System.Collections.Generic;
using PvsCommerce.Mobile.Models;

namespace PvsCommerce.Mobile.Services;

// Mirrors pvsecommerce/src/data/categories.tsx — same buckets, same keyword
// lists, same fallback to "grains". Update here and there in sync.
public static class CategoryRegistry
{
    public static readonly IReadOnlyList<CategoryDef> All = new[]
    {
        new CategoryDef { Id="oils",       Name="Oils & Oil Seeds",             Emoji="🫒", Keywords=new[]{"oil","oilseed","ghee"} },
        new CategoryDef { Id="grains",     Name="Grains, Pulses & Flours",      Emoji="🌾", Keywords=new[]{"grain","flour","rice","wheat","dal","gram","pulse","atta"} },
        new CategoryDef { Id="millets",    Name="Millets & Millet Products",    Emoji="🌾", Keywords=new[]{"millet","ragi","jowar","bajra","foxtail","kodo","barnyard"} },
        new CategoryDef { Id="snacks",     Name="Sweets & Snacks",              Emoji="🍪", Keywords=new[]{"snack","sweet","chikki","biscuit","murukku","laddu","cookie","jaggery sweet"} },
        new CategoryDef { Id="spices",     Name="Spices & Condiments",          Emoji="🌶", Keywords=new[]{"spice","masala","turmeric","chili","pepper","salt","condiment"} },
        new CategoryDef { Id="dryfruits",  Name="Dry Fruits, Seeds & Superfoods", Emoji="🥜", Keywords=new[]{"nut","almond","cashew","raisin","seed","chia","sunflower","superfood","dry fruit"} },
        new CategoryDef { Id="wellness",   Name="Personal Care & Wellness",     Emoji="🧴", Keywords=new[]{"soap","wellness","hair","skin","personal","ayur","herbal","balm"} },
        new CategoryDef { Id="eco",        Name="Eco-Friendly Household",       Emoji="♻️", Keywords=new[]{"eco","household","cleaner","biodegradable","bamboo","soapnut"} },
        new CategoryDef { Id="sweeteners", Name="Natural Sweeteners",           Emoji="🍯", Keywords=new[]{"honey","jaggery","sweetener","kakvi","palm sugar","panela"} },
        new CategoryDef { Id="utilities",  Name="Home Utilities",               Emoji="🏺", Keywords=new[]{"clay","pot","scrubber","utensil","kitchen","utility"} },
    };

    private static readonly Dictionary<string, CategoryDef> _byId =
        new(StringComparer.OrdinalIgnoreCase);

    static CategoryRegistry()
    {
        foreach (var c in All) _byId[c.Id] = c;
    }

    public static CategoryDef? GetById(string? id)
        => id is not null && _byId.TryGetValue(id, out var c) ? c : null;

    // Matches a backend product to its storefront bucket. Falls back to "grains".
    public static string BucketFor(string? category, string? productName)
    {
        var hay = $"{category ?? ""} {productName ?? ""}".ToLowerInvariant();
        foreach (var cat in All)
            foreach (var kw in cat.Keywords)
                if (hay.Contains(kw, StringComparison.Ordinal)) return cat.Id;
        return "grains";
    }
}
