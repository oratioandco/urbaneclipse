# Plaster Void — Astro static site → nginx.
# Multi-stage: build the static bundle (Node 22; Astro 7 requires >=22.12), serve via nginx.
FROM node:22-alpine AS build
WORKDIR /app
# Install deps first (cached layer).
COPY package.json package-lock.json ./
RUN npm ci
# Copy source (the committed public/berlin-core/ subset travels with it; .dockerignore
# excludes the gitignored full data/ + public/berlin/ + node_modules).
COPY . .
# PUBLIC_* env (e.g. the optional Cesium Ion token) is baked at build time by Astro.
ARG PUBLIC_CESIUM_ION_TOKEN=""
# Full Berlin (924 tiles / 545 MB) is served from a Docker volume mounted at
# /usr/share/nginx/html/berlin-full on the Hetzner host — SAME ORIGIN as the app, so no
# CORS is involved at all. The tiles are far too large for the image or for git, so
# they are synced to the host separately (see scripts/README.md).
# Override with --build-arg PUBLIC_TILESET_URL=/berlin-core/tileset.json to build an
# image that serves only the committed 20-tile subset.
ARG PUBLIC_TILESET_URL="/berlin-full/tileset.json"
ENV PUBLIC_CESIUM_ION_TOKEN=$PUBLIC_CESIUM_ION_TOKEN
ENV PUBLIC_TILESET_URL=$PUBLIC_TILESET_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# Coolify health check: nginx serves / -> 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
