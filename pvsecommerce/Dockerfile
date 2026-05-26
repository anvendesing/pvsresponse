# =====================================================================
# Prakruthivanam storefront - production image (static SPA + reverse proxy)
# =====================================================================
# Same pattern as erp-portal: Vite build -> nginx serves dist/ and
# proxies /v1/* and /health to the backend so the shop works on any IP
# without baking an API URL into the bundle.
# =====================================================================

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_MOCK_STOREFRONT_TOKEN=""
ENV VITE_MOCK_STOREFRONT_TOKEN=$VITE_MOCK_STOREFRONT_TOKEN
RUN npm run build

FROM nginx:${NGINX_VERSION} AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/shop.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost/health || exit 1
