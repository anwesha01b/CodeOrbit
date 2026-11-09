# CodeOrbit: one container running the API (+ the built web app) and the analysis worker.
FROM node:22-bookworm-slim

# git: the worker clones repositories; openssl: Prisma's query engine
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# install dependencies first so this layer is cached between code changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate && pnpm --filter @codeorbit/web build

ENV NODE_ENV=production
ENV WORKSPACE_DIR=/tmp/codeorbit-workspaces
EXPOSE 3001
CMD ["node", "scripts/start.mjs"]
