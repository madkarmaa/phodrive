ARG BUN_VERSION=1.4.3

# Compile architecture-neutral JavaScript and assets without emulation.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build-base
# Keep Bun invocation explicit and omit the image's node alias.
RUN rm -rf /usr/local/bun-node-fallback-bin

FROM build-base AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY core/package.json ./core/package.json
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
COPY cli/package.json ./cli/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY . .
RUN bun --bun run build

FROM oven/bun:${BUN_VERSION} AS base
RUN rm -rf /usr/local/bun-node-fallback-bin

FROM base AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY core/package.json ./core/package.json
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
COPY cli/package.json ./cli/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/core/node_modules ./core/node_modules
COPY --from=production-dependencies --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=build --chown=node:node /app/core/dist ./core/dist
COPY --from=build --chown=node:node /app/core/package.json ./core/package.json
# The server build includes the web app it serves.
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/drizzle ./server/drizzle
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/LICENSE ./
COPY --from=build --chown=node:node /app/LICENSES ./LICENSES

USER node
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
