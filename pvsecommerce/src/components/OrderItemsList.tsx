import type { CustomerOrderItem } from "@/lib/api";
import { inr } from "@/lib/format";
import { lineBarcode } from "@/lib/scanCode";

const lineMeta = (item: { productName: string; variantSize: string | null; barcode: string | null }) => {
  const params = item.variantSize;
  const name = params ? `${item.productName} · ${params}` : item.productName;
  const bc = lineBarcode(item);
  return bc ? `${name} · ${bc}` : name;
};

export const OrderItemsList = ({
  items,
  total,
}: {
  items: CustomerOrderItem[];
  total?: number;
}) => {
  if (items.length === 0) {
    return <p className="muted" style={{ fontSize: "0.9rem" }}>No line items available.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr
            style={{
              textAlign: "left",
              color: "var(--neutral-gray)",
              textTransform: "uppercase",
              fontSize: "0.7rem",
              letterSpacing: "0.08em",
            }}
          >
            <th style={{ padding: "0.6rem 0.5rem" }}>Product</th>
            <th style={{ padding: "0.6rem 0.5rem" }}>Qty</th>
            <th style={{ padding: "0.6rem 0.5rem" }}>Rate</th>
            <th style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
              <tr key={`${item.productId}:${item.variantId ?? "base"}`} style={{ borderTop: "1px solid rgba(34,37,31,0.06)" }}>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <div style={{ fontWeight: 600 }}>{lineMeta(item)}</div>
                </td>
                <td style={{ padding: "0.75rem 0.5rem" }} className="tnum">
                  {item.qty}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", color: "var(--neutral-gray)" }} className="tnum">
                  {inr(item.rate)}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600, textAlign: "right" }} className="tnum">
                  {inr(item.amount)}
                </td>
              </tr>
          ))}
        </tbody>
        {total != null && (
          <tfoot>
            <tr style={{ borderTop: "1.5px solid rgba(34,37,31,0.1)" }}>
              <td colSpan={3} style={{ padding: "0.85rem 0.5rem", fontWeight: 700, textAlign: "right" }}>
                Order total
              </td>
              <td style={{ padding: "0.85rem 0.5rem", fontWeight: 700, textAlign: "right", color: "var(--forest-green)" }} className="tnum">
                {inr(total)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
