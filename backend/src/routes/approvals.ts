import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { materialiseSO, snapshotQuote } from "./sales.js";

// Decision payload. `reason` is optional for approve, recommended for
// reject (so the salesperson knows why their quote bounced back). If
// supplied, it's appended to the Approval row's `reason` column for
// audit and surfaced on the linked entity (e.g. quote.notes) where
// applicable.
const decideSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});

export const approvalsRoutes = async (app: FastifyInstance) => {
  app.get("/approvals", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.approval.findMany({
      where: { status: q.status ?? "pending" },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/approvals/:id/decide", { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { id: string }).id;
    const { decision, reason } = decideSchema.parse(req.body);
    const before = await db.approval.findUnique({ where: { id } });
    const updated = await db.approval.update({
      where: { id },
      data: {
        status: decision,
        decidedAt: new Date(),
        decidedBy: req.user.name,
        // Append the decision reason if provided. We keep the original
        // request reason and prefix the new note so both are visible
        // on the audit row.
        ...(reason
          ? {
              reason: before
                ? `${before.reason}\n\n[${decision} by ${req.user.name}] ${reason}`
                : reason,
            }
          : {}),
      },
    });
    await recordChange("Approval", id, "update", updated, req.user.sub);

    // Side-effect 1: granting a Credit Limit approval materialises the SO
    // for the originating quote (ref = quoteNo).
    if (decision === "approved" && before?.type === "Credit Limit") {
      const quote = await db.quote.findUnique({ where: { quoteNo: before.ref } });
      if (quote && !quote.convertedSalesOrderId) {
        const so = await materialiseSO(quote.id, req.user.sub);
        return { approval: updated, salesOrder: so };
      }
    }

    // Side-effect 2: rejecting a Credit Limit approval bounces the
    // parked quote back to 'rejected' status. Without this the quote
    // stayed in 'accepted' forever (no SO, no clear signal to the
    // salesperson that the deal was killed).
    //
    // We only flip if the quote still looks like it was waiting on
    // this approval (status='accepted' and no SO yet). If the quote
    // has already moved on - someone reused force-convert, or it was
    // re-edited and re-submitted - we leave it alone and just record
    // the approval row.
    if (decision === "rejected" && before?.type === "Credit Limit") {
      const quote = await db.quote.findUnique({
        where: { quoteNo: before.ref },
      });
      if (
        quote &&
        quote.status === "accepted" &&
        !quote.convertedSalesOrderId
      ) {
        // Snapshot before mutating so the prior 'accepted' state is
        // preserved on the revision timeline.
        await snapshotQuote(quote.id, "credit_rejection", req.user.sub);
        const note = reason
          ? `Credit-limit approval rejected by ${req.user.name}: ${reason}`
          : `Credit-limit approval rejected by ${req.user.name}.`;
        const updatedQuote = await db.quote.update({
          where: { id: quote.id },
          data: {
            status: "rejected",
            rejectedAt: new Date(),
            // Preserve any existing notes the salesperson left and
            // append the rejection note for context.
            notes: quote.notes ? `${quote.notes}\n${note}` : note,
          },
        });
        await recordChange(
          "Quote",
          quote.id,
          "update",
          updatedQuote,
          req.user.sub
        );
        return { approval: updated, quote: updatedQuote };
      }
    }

    return updated;
  });
};
