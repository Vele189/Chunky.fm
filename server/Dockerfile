# better-sqlite3 is a native module. Debian (glibc) is used rather than Alpine
# so `npm ci` can take the published prebuild instead of compiling from source;
# the toolchain is installed anyway for the platforms that have no prebuild.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Same base as the runtime stage, so the compiled better-sqlite3 binding that
# survives the prune can be copied straight across.
FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Created here, and owned by `node`, so the empty named volume mounted over it
# inherits that ownership instead of coming up root-owned and unwritable.
RUN mkdir -p /data && chown node:node /data

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV HOST=0.0.0.0 \
    PORT=3000 \
    AUDIO_STORAGE_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
USER node

# Fastify logs every request, health probes included, so the steady-state
# interval is kept slow and the fast polling confined to start-up.
HEALTHCHECK --interval=30s --start-interval=2s --start-period=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Not `npm start`: that wrapper only exists to load a .env file, and in a
# container the environment is already the environment.
CMD ["node", "dist/index.js"]
