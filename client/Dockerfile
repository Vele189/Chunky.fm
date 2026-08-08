FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# `npm run build` typechecks before it bundles, and tsconfig.json takes in test/
# and scripts/ as well as src/ — so they all have to be here or tsc fails on
# files it was told to include but cannot find.
COPY tsconfig.json vite.config.ts index.html landing.html ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=30s --start-interval=1s --start-period=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
