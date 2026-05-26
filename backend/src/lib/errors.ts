import type { FastifyReply } from "fastify";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const sendError = (reply: FastifyReply, e: unknown) => {
  if (e instanceof HttpError) {
    return reply
      .code(e.statusCode)
      .send({ error: { code: e.code ?? "error", message: e.message, details: e.details } });
  }
  const err = e as Error;
  reply.code(500).send({ error: { code: "internal", message: err.message ?? "Internal error" } });
};
