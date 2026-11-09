# CodeOrbit

> Paste a public GitHub URL, get an interactive, LLM-assisted guided tour of the codebase — dependency graphs, an architecture map, complexity hotspots, and a RAG chatbot grounded in the real code.

Built entirely on free-tier / self-hostable infrastructure (Postgres + pgvector, pg-boss queue — no Redis, no S3).

## Monorepo layout

```
packages/
  shared/   canonical TypeScript types + API contracts (zod)
  api/      Fastify REST + SSE server
  worker/   pg-boss consumer running the analysis pipeline (spec §4)
  web/      React + Vite + Tailwind SPA
prisma/     canonical data model (spec §6), pgvector-enabled
docker-compose.yml   local Postgres + pgvector
```

## Prerequisites

- Node ≥ 20 and **pnpm** (`npm i -g pnpm`)
- **Python 3.x** (used by the `ui-ux-pro-max` design skill's search script; optional for the app)
- Postgres + pgvector — via Docker (`docker compose up`) **or** a free Supabase/Neon URL
- Git

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in DATABASE_URL + an LLM key

# option A: local DB
docker compose up -d
pnpm db:push                  # apply the Prisma schema (creates the vector extension)

# run the pieces (separate terminals)
pnpm dev:web                  # http://localhost:5173
pnpm dev:api                  # http://localhost:3001
pnpm dev:worker
```

> No Docker? Point `DATABASE_URL` at a free Supabase/Neon database (pgvector is pre-installed there) and skip `docker compose up`.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Monorepo scaffold, Docker/Prisma, API+worker skeletons, **landing page** | ✅ done |
| 1 | Ingest & file inventory (clone → tree → SSE) | next |
| 2 | Dependency graph (Tree-sitter, JS/TS + Python adapters) | — |
| 3 | Architecture map + hotspots | — |
| 4 | LLM enrichment + RAG chatbot (pgvector) | — |
| 5 | Breadth & robustness (more adapters, call graph, big repos) | — |
| 6 | Polish & ship (showcase, OG images, deploy) | — |

## Design

The frontend takes cues from [Attio](https://attio.com) and [Linear](https://linear.app):
a refined dark surface, Inter + JetBrains Mono, structured cards, restrained motion, and a
single violet/emerald accent system. The landing page features **live repo cards** that run
the analysis pipeline on load (Analyzing → Ready, metrics counting up) and a **live coding
panel** that streams the pipeline like a terminal.

## Tech stack

React · Vite · TypeScript · Tailwind · Fastify · pg-boss · Prisma · PostgreSQL + pgvector ·
Tree-sitter (Phase 2) · Gemini/Groq/Ollama behind one provider interface.
