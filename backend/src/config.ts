export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  storefrontJwtSecret:
    process.env.STOREFRONT_JWT_SECRET ??
    process.env.JWT_SECRET ??
    "dev-storefront-secret-change-in-production",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  /** Public storefront origin (PayU return redirects). */
  storefrontOrigin: process.env.STOREFRONT_ORIGIN ?? "http://localhost:5174",
  /** Public API base for PayU surl/furl (defaults to localhost backend). */
  publicApiBase:
    process.env.PUBLIC_API_BASE?.replace(/\/$/, "") ??
    `http://localhost:${process.env.PORT ?? "4000"}`,
};
