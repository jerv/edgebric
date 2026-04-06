# ─── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-slim AS deps

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY shared/types/package.json shared/types/

RUN pnpm install --frozen-lockfile

# ─── Stage 2: Build ──────────────────────────────────────────────────────────
FROM deps AS build

COPY tsconfig.json ./
COPY shared/ shared/
COPY packages/core/ packages/core/
COPY packages/api/ packages/api/
COPY packages/web/ packages/web/

# Build API (TypeScript) and Web (Vite)
RUN pnpm build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Copy everything from the build stage (node_modules + built code)
COPY --from=build /app/ /app/

# tsx is needed at runtime for TypeScript execution
RUN npm install -g tsx

# Data directory (mount a volume here for persistence)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3001
ENV LISTEN_HOST=0.0.0.0
ENV CONTAINER=1

EXPOSE 3001

# Run the API server with tsx (TypeScript execution)
CMD ["tsx", "packages/api/src/server.ts"]
