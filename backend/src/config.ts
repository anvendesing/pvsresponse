export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};
