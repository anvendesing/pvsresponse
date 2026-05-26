# =====================================================================
# NovaERP frontend - production image (static SPA + reverse proxy)
# =====================================================================
# Stage 1: build the SPA with Vite.
# Stage 2: serve dist/ via nginx and proxy /v1, /health to the backend.
#
# IMPORTANT: VITE_API_URL is an empty string by default so the SPA
# uses RELATIVE URLs and talks to whatever origin served the page.
# That means the same image works on any IP / port without rebuild
# (nginx forwards /v1/* and /health to the backend internally).
# =====================================================================

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# VITE_API_URL is intentionally empty for IP-only deployments. Override
# only if the SPA must talk to a backend on a different origin.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:${NGINX_VERSION} AS runtime
# Drop the default nginx site so our config is the sole one loaded.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/novaerp.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# Use the default nginx command (docker-entrypoint runs templating).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost/health || exit 1
