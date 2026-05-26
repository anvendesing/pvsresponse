import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

export const VALID_ROLES = [
  "admin",
  "supervisor",
  "warehouse",
  "procurement",
  "billing",
  "worker",
] as const;
type UserRole = (typeof VALID_ROLES)[number];

const loginSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(1),
});

const pinSchema = z.object({
  username: z.string().min(2),
  pin: z.string().length(6),
});

export const authRoutes = async (app: FastifyInstance) => {
  app.post("/auth/login", async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { username } });
    if (!user || !user.active) return reply.code(401).send({ error: { code: "invalid", message: "Invalid credentials" } });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: { code: "invalid", message: "Invalid credentials" } });
    const token = app.jwt.sign(
      { sub: user.id, role: user.role, name: user.name },
      { expiresIn: "12h" }
    );
    return { token, user: { id: user.id, username: user.username, name: user.name, role: user.role } };
  });

  app.post("/auth/pin", async (req, reply) => {
    const { username, pin } = pinSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { username } });
    if (!user || !user.active || !user.pin)
      return reply.code(401).send({ error: { code: "invalid", message: "Invalid credentials" } });
    const ok = await bcrypt.compare(pin, user.pin);
    if (!ok) return reply.code(401).send({ error: { code: "invalid", message: "Invalid PIN" } });
    const token = app.jwt.sign(
      { sub: user.id, role: user.role, name: user.name },
      { expiresIn: "8h" }
    );
    return { token, user: { id: user.id, username: user.username, name: user.name, role: user.role } };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    const u = await db.user.findUnique({ where: { id: req.user.sub } });
    return { id: u?.id, username: u?.username, name: u?.name, role: u?.role };
  });

  // Public list of users who can PIN-in. Used by the mobile login
  // screen so workers don't have to memorise their username. Returns
  // only `username` + `name` - no password hashes, no role - so it's
  // safe to expose unauthenticated.
  app.get("/auth/pin/users", async () => {
    const users = await db.user.findMany({
      where: {
        active: true,
        pin: { not: null },
        role: { in: ["warehouse", "worker", "supervisor", "admin"] },
      },
      select: { username: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    return users;
  });

  // ── GET /roles ── public list of valid roles (used by UI dropdowns) ──────────
  app.get("/roles", { preHandler: [app.authenticate] }, async () => {
    return VALID_ROLES.map((r) => ({ value: r, label: roleLabelMap[r] }));
  });

  // ── GET /users ── list all users (admin only) ────────────────────────────────
  app.get(
    "/users",
    { preHandler: [app.requireRole("admin")] },
    async (req) => {
      const q = (req.query as Record<string, string>) ?? {};
      const where: Record<string, unknown> = {};
      if (q.role) where.role = q.role;
      if (q.active !== undefined) where.active = q.active === "true";
      const users = await db.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          email: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
      return users;
    }
  );

  // ── POST /users ── create user (admin only) ──────────────────────────────────
  const createUserSchema = z.object({
    username: z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/, "Lowercase letters, digits, dots, hyphens only"),
    name: z.string().min(2).max(80),
    role: z.enum(VALID_ROLES),
    email: z.string().email().optional().nullable(),
    password: z.string().min(6),
    pin: z.string().length(6).regex(/^\d{6}$/).optional().nullable(),
  });
  app.post(
    "/users",
    { preHandler: [app.requireRole("admin")] },
    async (req, reply) => {
      const body = createUserSchema.parse(req.body);
      const exists = await db.user.findUnique({ where: { username: body.username } });
      if (exists) {
        return reply.code(409).send({ error: { code: "conflict", message: "Username already taken" } });
      }
      const passwordHash = await bcrypt.hash(body.password, 10);
      const pinHash = body.pin ? await bcrypt.hash(body.pin, 10) : null;
      const user = await db.user.create({
        data: {
          username: body.username,
          name: body.name,
          role: body.role,
          email: body.email ?? null,
          passwordHash,
          pin: pinHash,
        },
        select: { id: true, username: true, name: true, role: true, email: true, active: true, createdAt: true, updatedAt: true },
      });
      await recordChange("User", user.id, "insert", user, req.user.sub);
      return reply.code(201).send(user);
    }
  );

  // ── PATCH /users/:id ── update user (admin only) ─────────────────────────────
  const updateUserSchema = z.object({
    name: z.string().min(2).max(80).optional(),
    role: z.enum(VALID_ROLES).optional(),
    email: z.string().email().nullable().optional(),
    active: z.boolean().optional(),
    password: z.string().min(6).optional().nullable(),
    pin: z.string().length(6).regex(/^\d{6}$/).optional().nullable(),
  });
  app.patch(
    "/users/:id",
    { preHandler: [app.requireRole("admin")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = updateUserSchema.parse(req.body);

      // Prevent deactivating yourself
      if (body.active === false && id === req.user.sub) {
        return reply.code(400).send({ error: { code: "self_deactivate", message: "Cannot deactivate your own account" } });
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.role !== undefined) data.role = body.role;
      if (body.email !== undefined) data.email = body.email;
      if (body.active !== undefined) data.active = body.active;
      if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
      if (body.pin) data.pin = await bcrypt.hash(body.pin, 10);
      if (body.pin === null) data.pin = null;

      const user = await db.user.update({
        where: { id },
        data,
        select: { id: true, username: true, name: true, role: true, email: true, active: true, createdAt: true, updatedAt: true },
      });
      await recordChange("User", user.id, "update", user, req.user.sub);
      return user;
    }
  );

  // ── DELETE /users/:id ── hard-delete (admin only, self-protect) ──────────────
  app.delete(
    "/users/:id",
    { preHandler: [app.requireRole("admin")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (id === req.user.sub) {
        return reply.code(400).send({ error: { code: "self_delete", message: "Cannot delete your own account" } });
      }
      await db.user.delete({ where: { id } });
      return reply.code(204).send();
    }
  );
};

// Role labels shown in the UI
const roleLabelMap: Record<string, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  warehouse: "Warehouse",
  procurement: "Procurement",
  billing: "Billing / Office",
  worker: "Worker (mobile only)",
};
