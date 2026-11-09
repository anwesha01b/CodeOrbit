# CodeOrbit

**Interactive codebase maps for new contributors.**

Paste a public GitHub URL and CodeOrbit turns the repository into something you can actually read: an architecture map grouped by role, dependency and call graphs, a guided tour, a list of issues you can pick up, and a chatbot that answers with cited file paths.

Built for developers opening an unfamiliar repository: joining a team, reviewing a project, or looking for a first open-source contribution.

---

## What you get for every repository

| View | What it shows |
|---|---|
| **Overview** | A plain-English summary and mental model, a guided tour in reading order, complexity hotspots, language mix and architecture layers. |
| **Architecture** | Modules in swimlanes by role (API, security, core, data, utilities…). Click a module to see its summary, key files, what it uses and what uses it. |
| **Dependencies** | Every file and its imports, grouped by module or laid out top-down. Stars mark the best files to start with. |
| **Call graph** | Which function calls which, read top to bottom, with the file and line each one is defined on. |
| **Files** | The full file tree, coloured by hotspot score. |
| **Contribute** | Open GitHub issues, TODO/FIXME comments and untested hotspots, ranked by **priority** and **difficulty**, with tags, the reasons behind each ranking, and a "how to start" guide (files to read, tests to run). |

Plus:

- **Ask the repo:** a chatbot grounded in the real code. Answers cite file paths and pull in dependency, ownership and impact context when the question asks for it.
- **Impact analysis:** click any file to see everything that depends on it (up to 3 hops) and which tests to run before you change it.
- **Ownership:** top committers, last change and CODEOWNERS entries for every file.
- **Guides on every graph:** a "How to read this" panel, a colour legend and hover summaries, so a first-time viewer isn't left guessing.

## How it works

```
GitHub URL ──► validate & queue ──► shallow clone ──► file inventory
                                                          │
          Tree-sitter parsing (imports, definitions, calls, complexity)
                                                          │
       dependency + call graphs ──► metrics (churn, fan-in, hotspots, owners)
                                                          │
      modules & layers ──► guided tour ──► TODO scan ──► AI summaries + embeddings
                                                          │
                                       results + chat in the browser
```

- Analysis is **static**: the code is read, never executed. The clone is deleted when the job finishes; only the derived graphs, metrics and summaries are stored.
- Progress streams live to the browser while the job runs.
- AI is optional. Without an AI provider you still get every graph, metric, the tour and the Contribute list; summaries and chat need Gemini or Ollama.

## Supported languages

| Support | Languages |
|---|---|
| Imports, dependency graph, complexity | JavaScript, TypeScript, Python, Go, Java, C#, Ruby |
| Call graph (function-to-function) | JavaScript, TypeScript, Python |
| Basic import scan | PHP, Rust, C/C++, Swift, Kotlin, Scala, Dart, Elixir, Lua and more |

Every repository produces a result: unsupported languages still get the file tree, metrics and summaries.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Cytoscape.js |
| API | Node.js, Fastify, Server-Sent Events |
| Worker | pg-boss job queue, Tree-sitter (WASM), simple-git |
| Data | PostgreSQL 16 + pgvector, Prisma |
| AI | Google Gemini (generation + embeddings) or Ollama (local), behind one provider interface |

No Redis, no object storage: the job queue and the vector index both live in Postgres.

## Getting started

### Prerequisites

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`)
- **Docker** (for the local Postgres + pgvector database), or a hosted Postgres with pgvector such as Supabase or Neon
- **Git**
- Optional: a free [Gemini API key](https://aistudio.google.com/apikey) for summaries and the chatbot, or a local [Ollama](https://ollama.com) install

### 1. Install and configure

```bash
git clone https://github.com/anwesha01b/CodeOrbit.git
cd CodeOrbit
pnpm install
```

Copy the environment template and fill it in:

```bash
cp .env.example .env
```

(On Windows PowerShell: `Copy-Item .env.example .env`)

### 2. Start the database

```bash
docker compose up -d
pnpm db:push
```

`db:push` creates the tables and enables the `vector` extension.

### 3. Run the app

Run each in its own terminal:

```bash
pnpm dev:api      # API on http://localhost:3001
pnpm dev:worker   # analysis worker
pnpm dev:web      # app on http://localhost:5173
```

Open http://localhost:5173 and paste a repository URL, for example `github.com/pallets/click`.

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (the Docker default is already in `.env.example`). |
| `LLM_PROVIDER` | no | `gemini` (default), `ollama`, or `mock` for offline testing. |
| `GEMINI_API_KEY` | for AI | Enables summaries, the guided-tour narration and the chatbot. |
| `GEMINI_MODEL` | no | Comma-separated fallback list of Gemini models. |
| `OLLAMA_BASE_URL` | no | Ollama server address when `LLM_PROVIDER=ollama`. |
| `GITHUB_TOKEN` | recommended | Raises GitHub's API limit from 60 to 5,000 requests an hour (used for repo checks and the Contribute tab). |
| `API_PORT`, `WEB_ORIGIN` | no | API port and the allowed browser origin. |
| `WORKER_CONCURRENCY` | no | How many analyses run at once (default 2). |
| `MAX_REPO_FILES`, `MAX_REPO_SIZE_MB` | no | Safety limits for very large repositories. |

Never commit your `.env`: it is already in `.gitignore`.

## Project structure

```
packages/
  shared/   types, API contracts and the AI provider interface
  api/      Fastify REST + SSE server (graphs, impact, chat, contribute)
  worker/   analysis pipeline: clone, parse, graphs, metrics, tour, TODO scan, AI
  web/      React app (landing page and the analysis views)
prisma/     database schema (Postgres + pgvector)
docker-compose.yml   local Postgres + pgvector
```

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev:web` / `dev:api` / `dev:worker` | Run each part in watch mode |
| `pnpm typecheck` | Type-check every package |
| `pnpm build` | Build every package |
| `pnpm db:push` | Apply the Prisma schema to the database |
| `pnpm db:generate` | Regenerate the Prisma client |

## Limitations

- Public GitHub repositories only, up to 500 MB.
- Calls across files are matched by function name, so the call graph marks those links as "likely" rather than certain. Imports are always exact.
- Without a `GITHUB_TOKEN`, the Contribute tab can hit GitHub's hourly limit on busy days; tasks found in the code still show.
- On Gemini's free tier, AI summaries for large repositories can take a few minutes because of rate limits.
