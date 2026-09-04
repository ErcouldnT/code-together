# syntax=docker/dockerfile:1

# Debian rather than Alpine: better-sqlite3 ships glibc prebuilds for linux/arm64,
# so the image builds on the Pi without a C++ toolchain.
FROM node:22-bookworm-slim AS base
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app


# Two things the build stages have to defend against:
#  - Coolify injects `ARG NODE_ENV` into every stage, and a build ARG shows up as
#    an environment variable inside RUN. With NODE_ENV=production npm drops the
#    devDependencies and the build dies on a missing tsc/vite. ENV wins over ARG,
#    and --include=dev makes it explicit either way.
#  - better-sqlite3 ships prebuilt .node binaries; --ignore-scripts stops npm from
#    falling back to a node-gyp compile it does not need (npm ci quirk).
FROM base AS server-deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts


FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts


FROM server-deps AS server-build
COPY tsconfig.json ./
COPY shared ./shared
COPY src ./src
RUN npm run build


FROM base AS client-build
ENV NODE_ENV=development
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci --include=dev --ignore-scripts
COPY shared ./shared
COPY client ./client
RUN npm --prefix client run build


FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5000 \
    DATABASE_PATH=/app/data/together.db

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=client-build /app/client/dist ./client/dist
COPY drizzle ./drizzle
COPY package.json ./

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

# No EXPOSE / no published ports: Coolify's proxy reaches the container
# over the internal network only.
CMD ["node", "dist/src/server.js"]
