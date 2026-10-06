ARG BUN_VERSION=1.4.2

# Compile architecture-neutral JavaScript and assets without emulation.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build-base
# Keep Bun invocation explicit and omit the image's node alias.
RUN rm -rf /usr/local/bun-node-fallback-bin

FROM build-base AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY . .
RUN bun --bun run prepare && bun --bun run build

FROM oven/bun:${BUN_VERSION} AS base
RUN rm -rf /usr/local/bun-node-fallback-bin

FROM base AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=Infinity
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/build ./build
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/LICENSE* ./
USER bun
EXPOSE 3000
CMD ["bun", "build/server.js"]
