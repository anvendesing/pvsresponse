using System;
using System.Collections.Generic;

namespace NovaErp.Models;

public record AppUser(string Id, string Username, string Name, string Role);

public record AuthResult(string Token, AppUser User);

public record Product(
    string Id,
    string Sku,
    string Name,
    string Type,
    string Uom,
    string Barcode,
    string State,
    string Category,
    int StockOnHand,
    int ReorderLevel,
    double CostPrice,
    double SellingPrice,
    bool BatchTracked
);

public record Bin(
    string Id,
    string WarehouseId,
    string Zone,
    string Rack,
    string Shelf,
    string BinCode,
    int Capacity,
    int Occupied,
    int Qty,
    string? ProductSku,
    string? ProductName,
    string? Batch
);

public record ProductionOrder(
    string Id,
    string OrderNo,
    string Station,
    double PlannedQty,
    double ActualQty,
    double ScrapQty,
    double ReworkQty,
    string Status,
    DateTime StartDate,
    DateTime DueDate,
    double Efficiency
);

public record WorkOrder(
    string Id,
    string WorkOrderNo,
    string ProductionOrderId,
    string Station,
    string Machine,
    string Workers,
    double Output,
    double Target,
    string Status
);

public record DispatchOrder(
    string Id,
    string DispatchNo,
    string Vehicle,
    string Driver,
    string Destination,
    string Status,
    int EtaHours,
    double WeightKg
);

public record SyncMutation(
    string Entity,
    string EntityId,
    string Op,
    int? BaseVersion,
    Dictionary<string, object?> Payload,
    string ClientTime
);

public record PullChange(
    string Entity,
    string EntityId,
    string Op,
    int Version,
    Dictionary<string, object?> Payload,
    string ServerTime
);

public record PushApplied(string Entity, string EntityId, int Version);

public record PushConflict(
    string Entity,
    string EntityId,
    string Reason,
    Dictionary<string, object?> ServerPayload
);

public record PullResponse(
    string ServerTime,
    int NextCursor,
    List<PullChange> Changes,
    List<TombstoneRow> Tombstones
);

public record TombstoneRow(string Entity, string EntityId, string ServerTime);

public record PushResponse(
    List<PushApplied> Applied,
    List<PushConflict> Conflicts,
    string ServerTime,
    int Cursor
);
