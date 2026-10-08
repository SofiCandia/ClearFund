FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

FROM base AS production-dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --prod --filter @clearfun/backend... --frozen-lockfile

FROM base AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

COPY backend backend
COPY packages/sdk packages/sdk

RUN pnpm --filter @clearfun/sdk build \
  && pnpm --filter @clearfun/backend build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV="production"
ENV PORT="3000"
ENV DATABASE_URL="/app/data/app.db"
ENV EVIDENCE_STORAGE_DIR="/app/data/evidence"
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=production-dependencies --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=production-dependencies --chown=node:node /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/packages/sdk/dist ./packages/sdk/dist

RUN mkdir -p /app/data/evidence \
  && chown -R node:node /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 755 /usr/local/bin/docker-entrypoint

ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
CMD ["node", "backend/dist/server.js"]
