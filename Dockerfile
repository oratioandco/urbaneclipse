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
ARG PUBLIC_TILESET_URL="/berlin-core/tileset.json"
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
