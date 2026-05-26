// Shared helpers for the document-sharing feature. Each shareable
// document model (Quote, SalesOrder, Invoice, PackingSlip) carries an
// opaque `shareToken` column that lets the customer fetch a sanitized
// read-only view via /v1/public/<docs>/:token without logging in.
//
// We use crypto.randomBytes(12) -> 24 hex chars, giving 96 bits of
// entropy which is more than enough to make the link unguessable.

import { randomBytes } from "node:crypto";

export const mintShareToken = (): string => randomBytes(12).toString("hex");
