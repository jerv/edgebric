# ─── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-slim AS deps

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/edge/package.json packages/edge/
COPY packages/web/package.json packages/web/
COPY shared/types/package.json shared/types/

RUN pnpm install --frozen-lockfile

# ─── Stage 2: Build ──────────────────────────────────────────────────────────
FROM deps AS build

COPY tsconfig.json ./
COPY shared/ shared/
COPY packages/core/ packages/core/
COPY packages/edge/ packages/edge/
COPY packages/api/ packages/api/
COPY packages/web/ packages/web/

# Build API (TypeScript) and Web (Vite)
RUN pnpm build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN corepack enable pnpm

WORKDIR /app

# Copy everything from the build stage (node_modules + built code).
# tsx is a devDependency but required at runtime for TypeScript execution.
COPY --from=build /app/ /app/

# Data directory (mount a volume here for persistence)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3001

EXPOSE 3001

# Run the API server with tsx (TypeScript execution)
CMD ["npx", "tsx", "packages/api/src/server.ts"]
