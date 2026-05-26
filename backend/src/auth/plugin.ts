import fp from "fastify";
import jwtPlugin from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string; name: string };
    user: { sub: string; role: string; name: string };
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwtPlugin, { secret: config.jwtSecret });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid or missing token." } });
    }
  });

  app.decorate(
    "requireRole",
    (...roles: string[]) =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          await req.jwtVerify();
        } catch {
          return reply.code(401).send({ error: { code: "unauthorized", message: "Login required." } });
        }
        if (!roles.includes(req.user.role) && req.user.role !== "admin") {
          return reply
            .code(403)
            .send({ error: { code: "forbidden", message: `Role '${req.user.role}' not permitted.` } });
        }
      }
  );
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: string[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
