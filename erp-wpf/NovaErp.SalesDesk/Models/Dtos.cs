namespace NovaErp.SalesDesk.Models;

public sealed class ApiUser
{
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    public string Name { get; set; } = "";
    public string Role { get; set; } = "";
}

public sealed class AuthResponse
{
    public string Token { get; set; } = "";
    public ApiUser User { get; set; } = new();
}

public sealed class CustomerRow
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? AddressLine { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Pincode { get; set; }
    public string? Gst { get; set; }
    public string? Contact { get; set; }
    public decimal CreditLimit { get; set; }
    public decimal OpenBalance { get; set; }
    public decimal? AvailableCredit { get; set; }
    public string? PriceListId { get; set; }
    public bool Active { get; set; } = true;

    public string DisplayLine => $"{Code} · {Name}";
    public string LocationLine => string.Join(", ", new[] { City, State, Pincode }.Where(s => !string.IsNullOrWhiteSpace(s)));
}

public sealed class CustomerInput
{
    public string? Code { get; set; }
    public string Name { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string City { get; set; } = "";
    public string? State { get; set; }
    public string Pincode { get; set; } = "";
    public string? Gst { get; set; }
    public string? Contact { get; set; }
    public decimal CreditLimit { get; set; }
    public string? PriceListId { get; set; }
    public bool Active { get; set; } = true;
}

public sealed class StatementEntry
{
    public string Date { get; set; } = "";
    public string Type { get; set; } = "";
    public string Ref { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public decimal Balance { get; set; }
    public string? Status { get; set; }
}

public sealed class CustomerStatement
{
    public CustomerRow Customer { get; set; } = new();
    public List<StatementEntry> Entries { get; set; } = [];
}

public sealed class CustomerPayment
{
    public string Id { get; set; } = "";
    public string PaymentNo { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public decimal Amount { get; set; }
    public string Mode { get; set; } = "";
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public string PaymentDate { get; set; } = "";
}

public sealed class ProductVariant
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string? Barcode { get; set; }
    public string? Size { get; set; }
    public string? Color { get; set; }
    public string? Grade { get; set; }
    public string? Uom { get; set; }
    public decimal StockOnHand { get; set; }
    public bool Active { get; set; } = true;
    public decimal? SellingPriceOverride { get; set; }

    public string Label => string.Join(" ", new[] { Size, Color, Grade }.Where(s => !string.IsNullOrWhiteSpace(s)));
}

public sealed class Product
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Uom { get; set; } = "";
    public string? Barcode { get; set; }
    public decimal StockOnHand { get; set; }
    public decimal SellingPrice { get; set; }
    public List<ProductVariant>? Variants { get; set; }

    public string Display => $"{Sku} · {Name}";
}

public sealed class ResolvedPrice
{
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public decimal Price { get; set; }
    public string Source { get; set; } = "";
}

public sealed class QuoteItemRow
{
    public string? Id { get; set; }
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public decimal Qty { get; set; }
    public decimal Rate { get; set; }
    public decimal Discount { get; set; }
    public decimal Amount { get; set; }
    public Product? Product { get; set; }
    public ProductVariant? Variant { get; set; }
}

public sealed class QuoteRow
{
    public string Id { get; set; } = "";
    public string QuoteNo { get; set; } = "";
    public int Revision { get; set; }
    public string CustomerId { get; set; } = "";
    public string Status { get; set; } = "";
    public string ValidUntil { get; set; } = "";
    public decimal SubTotal { get; set; }
    public decimal Tax { get; set; }
    public decimal TransportCharge { get; set; }
    public decimal Total { get; set; }
    public string? Notes { get; set; }
    public string? ConvertedSalesOrderId { get; set; }
    public CustomerRow? Customer { get; set; }
    public List<QuoteItemRow> Items { get; set; } = [];
}

public sealed class QuoteLineDraft
{
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string VariantLabel { get; set; } = "";
    public decimal Qty { get; set; } = 1;
    public decimal Rate { get; set; }
    public decimal Discount { get; set; }
    public decimal Amount => Qty * Rate - Discount;
}

public sealed class QuoteCreatePayload
{
    public string CustomerId { get; set; } = "";
    public string? ValidUntil { get; set; }
    public string? Notes { get; set; }
    public decimal TransportCharge { get; set; }
    public List<QuoteItemPayload> Items { get; set; } = [];
}

public sealed class QuoteItemPayload
{
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public decimal Qty { get; set; }
    public decimal Rate { get; set; }
    public decimal Discount { get; set; }
}

public sealed class SalesOrderRow
{
    public string Id { get; set; } = "";
    public string SoNo { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public string Status { get; set; } = "";
    public string OrderDate { get; set; } = "";
    public decimal Total { get; set; }
    public string? QuoteId { get; set; }
    public CustomerRow? Customer { get; set; }
    public List<SalesOrderItemRow> Items { get; set; } = [];
}

public sealed class SalesOrderItemRow
{
    public string Id { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public decimal QtyOrdered { get; set; }
    public decimal QtyInvoiced { get; set; }
    public decimal Rate { get; set; }
    public decimal Amount { get; set; }
    public Product? Product { get; set; }
    public ProductVariant? Variant { get; set; }
}

public sealed class PickListItemRow
{
    public string Id { get; set; } = "";
    public string SalesOrderItemId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public string? BinId { get; set; }
    public decimal QtyToPick { get; set; }
    public decimal QtyPicked { get; set; }
    public Product? Product { get; set; }
    public ProductVariant? Variant { get; set; }
    public BinSummary? Bin { get; set; }
}

public sealed class BinSummary
{
    public string Id { get; set; } = "";
    public string Zone { get; set; } = "";
    public string Shelf { get; set; } = "";
    public string Bin { get; set; } = "";
    public string Path => $"{Zone}/{Shelf}/{Bin}";
}

public sealed class PickListRow
{
    public string Id { get; set; } = "";
    public string PickListNo { get; set; } = "";
    public string SalesOrderId { get; set; } = "";
    public string Status { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public SalesOrderRef? SalesOrder { get; set; }
    public List<PickListItemRow> Items { get; set; } = [];
}

public sealed class SalesOrderRef
{
    public string Id { get; set; } = "";
    public string SoNo { get; set; } = "";
    public string Status { get; set; } = "";
    public CustomerRow? Customer { get; set; }
}

public sealed class PackingSlipItemRow
{
    public string Id { get; set; } = "";
    public string SalesOrderItemId { get; set; } = "";
    public decimal QtyOrdered { get; set; }
    public decimal QtyPicked { get; set; }
    public decimal QtyPacked { get; set; }
    public Product? Product { get; set; }
    public ProductVariant? Variant { get; set; }
}

public sealed class PackingSlipRow
{
    public string Id { get; set; } = "";
    public string PackingSlipNo { get; set; } = "";
    public string SalesOrderId { get; set; } = "";
    public string Status { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public SalesOrderRef? SalesOrder { get; set; }
    public List<PackingSlipItemRow> Items { get; set; } = [];
}

public sealed class AcceptQuoteResponse
{
    public bool CreditHold { get; set; }
    public string? Message { get; set; }
    public bool AlreadyConverted { get; set; }
    public SalesOrderRow? SalesOrder { get; set; }
    public QuoteRow? Quote { get; set; }
}

public sealed class CompletePickResponse
{
    public PickListRow PickList { get; set; } = new();
    public PackingSlipRow PackingSlip { get; set; } = new();
}
