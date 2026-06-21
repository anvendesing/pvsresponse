import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSpecPath(): string {
  // dist/src/openapi.js  → ../openapi.json (dist/) or ../../openapi.json (repo root)
  // src/openapi.ts (tsx) → ../openapi.json (backend/)
  const candidates = [
    join(__dirname, "..", "openapi.json"),
    join(__dirname, "..", "..", "openapi.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("openapi.json not found — run: npm run openapi:generate");
}

/** Serve OpenAPI spec + Swagger UI at /docs (static spec from openapi.json). */
export async function registerOpenApi(app: FastifyInstance) {
  const specPath = resolveSpecPath();

  await app.register(fastifySwagger, {
    mode: "static",
    specification: {
      path: specPath,
      baseDir: dirname(specPath),
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
}
