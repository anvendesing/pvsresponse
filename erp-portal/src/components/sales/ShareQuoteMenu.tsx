// Thin wrapper around ShareDocumentMenu specialized for Quote rows.
// Kept for backwards compatibility with existing call sites; new
// callers should use ShareDocumentMenu directly.

import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";
import { api, type QuoteRow } from "@/lib/api";

interface Props {
  quote: QuoteRow;
  onTokenChanged?: (token: string) => void;
  size?: "sm" | "md";
}

export const ShareQuoteMenu = ({ quote, onTokenChanged, size }: Props) => {
  const validUntilLine = `Valid until ${quote.validUntil.slice(0, 10)}` +
    (quote.paymentTerms ? `\nPayment terms: ${quote.paymentTerms}` : "");

  return (
    <ShareDocumentMenu
      size={size}
      descriptor={{
        kind: "quote",
        id: quote.id,
        docNo: quote.quoteNo,
        shareToken: quote.shareToken ?? null,
        customerName: quote.customer.name,
        customerContact: quote.customer.contact ?? null,
        total: quote.total,
        contextLine: validUntilLine,
        rotateToken: async (id) => (await api.rotateQuoteShareToken(id)).shareToken,
        onTokenChanged,
      }}
    />
  );
};
