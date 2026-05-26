using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace PvsCommerce.Mobile.Models;

// Mirrors the /v1/storefront-mock/catalog response shape produced by
// backend/src/routes/storefront-mock.ts. Keep field names aligned —
// the backend serializer is camelCase via Fastify defaults.

public sealed class CatalogVariant
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("sku")] public string Sku { get; init; } = "";
    [JsonPropertyName("size")] public string? Size { get; init; }
    [JsonPropertyName("color")] public string? Color { get; init; }
    [JsonPropertyName("grade")] public string? Grade { get; init; }
    [JsonPropertyName("uom")] public string? Uom { get; init; }
    [JsonPropertyName("packSize")] public int PackSize { get; init; }
    [JsonPropertyName("stockOnHand")] public int StockOnHand { get; init; }
    [JsonPropertyName("price")] public double Price { get; init; }
}

public class CatalogProduct
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("sku")] public string Sku { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("category")] public string Category { get; init; } = "";
    [JsonPropertyName("uom")] public string Uom { get; init; } = "";
    [JsonPropertyName("sellingPrice")] public double SellingPrice { get; init; }
    [JsonPropertyName("stockOnHand")] public int StockOnHand { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("imageHint")] public string? ImageHint { get; init; }
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; init; }
    [JsonPropertyName("tags")] public List<string> Tags { get; init; } = new();
    [JsonPropertyName("variants")] public List<CatalogVariant> Variants { get; init; } = new();
}

public sealed class ProductDetail : CatalogProduct
{
    [JsonPropertyName("ingredients")] public string? Ingredients { get; init; }
}

[JsonSerializable(typeof(CatalogProduct))]
[JsonSerializable(typeof(CatalogProduct[]))]
[JsonSerializable(typeof(List<CatalogProduct>))]
[JsonSerializable(typeof(ProductDetail))]
[JsonSerializable(typeof(CatalogVariant))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
public partial class CatalogJsonContext : JsonSerializerContext { }
