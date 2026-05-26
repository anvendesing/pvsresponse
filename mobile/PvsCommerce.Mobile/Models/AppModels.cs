using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace PvsCommerce.Mobile.Models;

// ─── Cart ────────────────────────────────────────────────────────────────────
public sealed class CartLine
{
    [JsonPropertyName("productId")]   public string ProductId   { get; init; } = "";
    [JsonPropertyName("productSku")]  public string ProductSku  { get; init; } = "";
    [JsonPropertyName("productName")] public string ProductName { get; init; } = "";
    [JsonPropertyName("variantId")]   public string? VariantId  { get; init; }
    [JsonPropertyName("variantSku")]  public string? VariantSku { get; init; }
    [JsonPropertyName("variantSize")] public string? VariantSize { get; init; }
    [JsonPropertyName("qty")]         public int Qty            { get; set; }
    [JsonPropertyName("rate")]        public double Rate        { get; init; }
    [JsonPropertyName("available")]   public int Available      { get; init; }
    [JsonPropertyName("packagingHint")] public string PackagingHint { get; init; } = "craft-bag";

    [JsonIgnore] public string LineKey => VariantId ?? ProductId;
    [JsonIgnore] public double LineTotal => Qty * Rate;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
public sealed class AuthUser
{
    [JsonPropertyName("name")]  public string Name  { get; init; } = "";
    [JsonPropertyName("email")] public string Email { get; init; } = "";
    [JsonPropertyName("phone")] public string Phone { get; init; } = "";
}

// ─── Storefront order ────────────────────────────────────────────────────────
public sealed class StorefrontOrderItem
{
    [JsonPropertyName("productId")] public string ProductId { get; init; } = "";
    [JsonPropertyName("variantId")] public string? VariantId { get; init; }
    [JsonPropertyName("qty")]       public int Qty { get; init; }
}

public sealed class StorefrontOrderRequest
{
    [JsonPropertyName("name")]  public string Name  { get; init; } = "";
    [JsonPropertyName("email")] public string Email { get; init; } = "";
    [JsonPropertyName("phone")] public string Phone { get; init; } = "";
    [JsonPropertyName("city")]  public string? City  { get; init; }
    [JsonPropertyName("notes")] public string? Notes { get; init; }
    [JsonPropertyName("items")] public List<StorefrontOrderItem> Items { get; init; } = new();
}

public sealed class StorefrontOrderResponse
{
    [JsonPropertyName("soNo")]      public string SoNo      { get; init; } = "";
    [JsonPropertyName("invoiceNo")] public string InvoiceNo { get; init; } = "";
}

// ─── Past orders ─────────────────────────────────────────────────────────────
public sealed class PastOrder
{
    [JsonPropertyName("soNo")]      public string SoNo      { get; init; } = "";
    [JsonPropertyName("status")]    public string Status    { get; init; } = "";
    [JsonPropertyName("createdAt")] public string CreatedAt { get; init; } = "";
    [JsonPropertyName("total")]     public double Total     { get; init; }
    [JsonPropertyName("lines")]     public List<PastOrderLine> Lines { get; init; } = new();
}

public sealed class PastOrderLine
{
    [JsonPropertyName("productName")] public string ProductName { get; init; } = "";
    [JsonPropertyName("qty")]         public int Qty            { get; init; }
    [JsonPropertyName("rate")]        public double Rate        { get; init; }
}

// ─── Category ────────────────────────────────────────────────────────────────
public sealed class CategoryDef
{
    public string Id       { get; init; } = "";
    public string Name     { get; init; } = "";
    public string Emoji    { get; init; } = "🌿";
    public string[] Keywords { get; init; } = System.Array.Empty<string>();
}

// ─── JSON source-gen contexts ────────────────────────────────────────────────
[JsonSerializable(typeof(CartLine))]
[JsonSerializable(typeof(List<CartLine>))]
[JsonSerializable(typeof(AuthUser))]
[JsonSerializable(typeof(StorefrontOrderRequest))]
[JsonSerializable(typeof(StorefrontOrderItem))]
[JsonSerializable(typeof(List<StorefrontOrderItem>))]
[JsonSerializable(typeof(StorefrontOrderResponse))]
[JsonSerializable(typeof(List<PastOrder>))]
[JsonSerializable(typeof(PastOrder))]
[JsonSerializable(typeof(PastOrderLine))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
public partial class AppJsonContext : JsonSerializerContext { }
