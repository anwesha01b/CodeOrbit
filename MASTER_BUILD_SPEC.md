# CodeOrbit — Master Build Spec

> A tool that ingests any public GitHub repository and produces an interactive, visual, LLM-assisted "guided tour" so a new developer can understand the codebase from scratch.

**Version:** 1.0
**Owner:** Anwesha Bhagat
**Status:** Draft → Build
**Last updated:** 2026-11-07

---

## 1. Product Vision

### 1.1 One-line pitch
Paste a GitHub URL, get an interactive map of the codebase — dependency graphs, an architecture overview, complexity hotspots, and plain-English explanations of what each part does and how it fits together.

### 1.2 The problem
Onboarding onto an unfamiliar codebase is slow and painful. READMEs are often stale or missing, architecture lives only in senior engineers' heads, and new developers burn days just figuring out "where does execution start" and "which files actually matter." Existing tools are either language-specific, require local setup per language, or only show raw file trees.

### 1.3 The solution
A language-agnostic web app that clones a public repo, parses it into a structural model, and renders:
- A **dependency / import graph** (the backbone),
- An **architecture / module map** (clustered subsystems),
- A **file tree with hotspots** (size, complexity, churn),
- A best-effort **call graph**,
- **LLM-generated explanations** at repo, module, and file level,
- A **chat interface** to ask questions about the repo ("where is auth handled?").

### 1.4 Who it's for
- New hires / contributors onboarding onto a project.
- Developers evaluating an open-source library before adopting it.
- Interviewers / reviewers trying to quickly grok a candidate's project.

### 1.5 Success criteria (for this build)
- Analyze a mid-size repo (≤ ~2,000 files) end-to-end in under ~3 minutes.
- Works on at least 6 language ecosystems (JS/TS, Python, Java, Go, Ruby, C#) for dependency graphs; graceful degradation for anything else.
- Shareable public result link (good portfolio demo).
- Clean, documented, deployed, and stable — this is a resume piece, so polish and a live demo matter as much as feature count.

### 1.6 Explicit non-goals (v1)
- No private repos / GitHub OAuth (planned as a later phase).
- No runtime / dynamic analysis — static only.
- No code editing, PRs, or write-back to GitHub.
- No perfectly accurate cross-language call graph (best-effort, language-dependent).
- Not a security scanner or linter.

---

## 2. Decisions Locked In

| Decision | Choice | Rationale |
|---|---|---|
| Understanding engine | **LLM-powered** (static graphs + LLM summaries/chat) | Highest resume value; natural-language onboarding is the differentiator. |
| Deployment | **Hosted web app** | Shareable live demo; strongest portfolio artifact. |
| Repo access | **Public repos only** | Removes OAuth complexity for v1; still demos the full pipeline. |
| Core visualizations | Dependency graph, Architecture map, File tree + hotspots, Call graph (best-effort) | Covers the "how is this wired" questions a new dev has. |
| Frontend | React | Per requirement. |
| Backend | Node.js | Per requirement. |
| Database | PostgreSQL | Per requirement. |

---

## 3. High-Level Architecture

```
                         ┌─────────────────────────────┐
                         │         Browser (SPA)        │
                         │   React + graph rendering     │
                         └──────────────┬───────────────┘
                                        │ HTTPS / REST + SSE
                         ┌──────────────▼───────────────┐
                         │        API Server (Node)      │
                         │  Express/Fastify + REST + SSE │
                         └───┬───────────────┬───────────┘
                             │               │
                   enqueue   │               │ read/write
                             ▼               ▼
                   ┌──────────────┐   ┌──────────────┐
                   │  Job Queue   │   │  PostgreSQL  │
                   │ (BullMQ/Redis)│   │   (metadata, │
                   └──────┬───────┘   │   graphs,    │
                          │           │   summaries) │
                          ▼           └──────────────┘
               ┌─────────────────────┐
               │   Analysis Worker    │
               │  (Node process)      │
               │  1. clone repo       │
               │  2. detect languages │
               │  3. parse → AST/deps │
               │  4. build graphs     │
               │  5. metrics/hotspots │
               │  6. LLM summaries    │
               └──────┬──────────────┘
                      │ calls
          ┌───────────▼───────────┐     ┌──────────────┐
          │  Tree-sitter parsers  │     │  LLM API     │
          │  + language adapters  │     │ (Claude/GPT) │
          └───────────────────────┘     └──────────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │  Object storage (S3)  │  ← raw repo snapshot, large graph JSON
          └───────────────────────┘
```

### 3.1 Why a job queue
Cloning + parsing + LLM calls can take minutes and are CPU/IO heavy. The API must stay responsive, so analysis runs in a **background worker**. The frontend subscribes to progress via **Server-Sent Events (SSE)** (simpler than WebSockets for one-way progress) or polls job status.

### 3.2 Why Postgres + object storage
Postgres holds structured, queryable data (repos, jobs, nodes, edges, summaries). Large blobs — the full graph JSON, raw file snapshots — go to object storage (S3/MinIO) and are referenced by URL/key, keeping rows small and queries fast.

---

## 4. Analysis Pipeline (the core IP)

This is the heart of the product. It runs in the worker as an ordered, resumable pipeline. Each stage writes its output so a failure can resume from the last good stage.

### Stage 0 — Intake & validation
- Accept a GitHub URL. Validate it's a public repo via the GitHub REST API (`GET /repos/{owner}/{repo}`).
- Reject: private repos, repos over a size cap (e.g. > 500 MB or > ~15k files — configurable), non-existent repos.
- Record repo metadata: default branch, size, primary language (GitHub's guess), star count, license.
- Create a `jobs` row with status `queued`.

### Stage 1 — Fetch source
- Shallow clone the default branch: `git clone --depth 1 --single-branch`.
- Snapshot the tree to object storage (optional, enables re-analysis without re-clone).
- Compute file inventory: path, size, extension, detected language, binary/text flag.
- **Churn data (for hotspots):** run `git log` on a bounded history (e.g. last 500 commits or last 12 months) to count commits-per-file. Shallow clone won't have history, so for hotspots use `git clone --filter=blob:none` (treeless) which keeps history cheaply, or a second fetch of log data. Document the tradeoff; churn is "nice to have," not blocking.

### Stage 2 — Language detection & filtering
- Detect language per file via extension + heuristics (reuse `linguist`-style mapping; there are npm ports).
- Apply ignore rules: `node_modules`, `vendor`, `dist`, `build`, `.git`, lockfiles, minified files, generated code, binaries, images. Respect `.gitignore` plus a built-in denylist.
- Produce the **working file set** — the files that actually get parsed.

### Stage 3 — Parse to a common model
This is where language-agnosticism is achieved. Use **Tree-sitter** as the universal parser: it has grammars for ~40+ languages and a consistent API. For each supported language, a thin **language adapter** extracts:
- **Imports / requires / includes** → edges for the dependency graph.
- **Definitions** (functions, classes, methods, exported symbols) → nodes for the call graph.
- **References / call sites** → best-effort call-graph edges (intra-file reliable; cross-file via symbol resolution, which is approximate).

All adapters emit into a single **canonical graph schema** (see §6) so downstream stages are language-independent.

**Degradation ladder** (critical for "any language"):
1. **Tier A — full adapter** (JS/TS, Python, Java, Go, Ruby, C#): imports + defs + best-effort calls.
2. **Tier B — Tree-sitter grammar exists but no custom adapter:** extract file list + top-level symbols + a generic "import-like" heuristic (regex on common import keywords). Dependency graph works at file level; call graph limited.
3. **Tier C — no grammar / unknown language:** file-tree + size/churn metrics + LLM-only summaries. No parsed graph, but the repo still produces useful output.

The product **never hard-fails on an unknown language** — it drops to the next tier.

### Stage 4 — Build graphs
From the canonical model, construct:
- **Dependency graph:** nodes = files/modules, edges = imports. Resolve relative imports to real files; mark external/package imports as a separate node class.
- **Architecture map:** cluster the dependency graph into subsystems. Start with **directory-based clustering** (folders ≈ modules) as the reliable baseline, then optionally refine with a community-detection algorithm (e.g. Louvain / label propagation) on the dependency graph. Label clusters using folder names + LLM.
- **Call graph:** nodes = functions/methods, edges = call sites. Honestly scoped as best-effort.
- **File tree + hotspots:** the directory tree annotated with per-file metrics.

### Stage 5 — Metrics & hotspots
Per file / per module, compute:
- **Size:** lines of code (exclude blanks/comments where cheap).
- **Complexity:** a cheap proxy — cyclomatic-ish count from Tree-sitter node counts (branches, loops, conditionals). Doesn't need to be textbook-exact; it needs to rank files.
- **Churn:** commit count per file from git history.
- **Fan-in / fan-out:** in/out degree in the dependency graph (high fan-in = load-bearing file; new devs should read these first).
- **Hotspot score:** combine complexity × churn (classic "code that's both complex and frequently changed = risky/important").
- **"Start here" ranking:** a composite score (high fan-in + entry-point heuristics like `main`, `index`, `app`, `server`, framework entry files) to suggest a reading order.

### Stage 6 — LLM enrichment
Three levels, built bottom-up so higher levels summarize lower ones (keeps token cost bounded — never dump the whole repo into one prompt):
1. **File-level:** for the top-N most important files (by the "start here" score, not every file — cost control), send the file (truncated if huge) + its imports/exports and ask for a short summary: purpose, key exports, notable dependencies.
2. **Module-level:** for each cluster, summarize from its files' summaries (not raw code) → "what this subsystem does."
3. **Repo-level:** from module summaries + README + metadata → an executive overview, a suggested reading order, and a "mental model" paragraph.
- **Chat / Q&A:** store summaries + a lightweight retrieval index (file summaries + paths) so the chat feature can answer "where is X handled?" by retrieving relevant files and letting the LLM answer with citations (file paths). Full RAG with embeddings is a stretch goal; v1 can retrieve on summary keyword match + path.

**Cost controls (must-have):** cap files sent to the LLM; truncate large files; cache summaries by file content hash (same file across re-runs = no re-spend); make the LLM layer fully optional per job so static graphs render even if the LLM budget is exhausted.

### Stage 7 — Persist & publish
- Write nodes, edges, metrics, and summaries to Postgres (and large graph JSON to object storage).
- Flip job status to `complete`, emit final SSE event.
- Generate a stable public result URL: `/{owner}/{repo}` or `/r/{jobId}`.

---

## 5. Frontend (React)

### 5.1 Pages / routes
- `/` — landing page: URL input, short explainer, a few example repos (pre-analyzed, for instant demo — important so your portfolio link never shows a cold/slow first impression).
- `/analyzing/:jobId` — live progress view (SSE-driven stage checklist + log).
- `/r/:jobId` or `/:owner/:repo` — the result dashboard.
- `/about` — what it is / how it works (good for a resume project).

### 5.2 Result dashboard layout
- **Left rail:** file tree (with hotspot heat coloring) + search.
- **Center:** the active visualization (switchable tabs: Dependencies / Architecture / Call graph).
- **Right rail:** context panel — LLM summary for the selected node (repo/module/file), metrics, and "related files."
- **Top bar:** repo metadata (stars, language mix, license), "Start here" reading list, and the chat/ask button.
- **Chat drawer:** ask-the-repo Q&A with cited file paths.

### 5.3 Graph rendering
- Interactive, zoomable, pannable; click a node → load its summary + highlight neighbors.
- **Library choice:** for force-directed / relationship graphs use **Cytoscape.js** (robust, handles thousands of nodes, built-in layouts) or **React Flow** (nicer DX, better for curated/architecture views) — recommend **Cytoscape.js for the big dependency/call graphs** and **React Flow for the clean architecture map**. For very large graphs, render WebGL (Sigma.js) or aggregate to module level by default and expand on demand.
- **Performance rule:** never render 2,000 raw file nodes at once. Default to the **module/architecture view**, let the user drill into a module to see its files. Progressive disclosure is a core UX principle here.

### 5.4 Key UX principles
- **Progressive disclosure:** repo overview → module → file → symbol.
- **Always answer "where do I start?"** prominently — it's the whole point.
- **Never a blank screen:** show skeletons during load, show the static graph even if LLM text is still streaming.
- **Shareability:** every result has a clean URL and an OG image (auto-generated preview) for when it's shared.

### 5.5 State / data
- React Query (TanStack Query) for server state + caching.
- SSE hook for job progress.
- Graph data fetched lazily per view (don't load the call graph until its tab is opened).

---

## 6. Data Model (PostgreSQL)

Canonical, language-independent schema. Graph tables are generic (nodes/edges with a `type`) so any language maps into the same shape.

```
repos
  id            uuid pk
  owner         text
  name          text
  default_branch text
  github_stars  int
  size_kb       int
  license       text
  primary_language text
  created_at    timestamptz
  UNIQUE(owner, name)

jobs
  id            uuid pk
  repo_id       uuid fk -> repos
  commit_sha    text           -- exact analyzed commit (results are pinned to it)
  status        text           -- queued|cloning|parsing|graphing|metrics|llm|complete|failed
  stage         text           -- current stage for progress UI
  progress_pct  int
  error         text null
  llm_enabled   bool
  started_at    timestamptz
  finished_at   timestamptz null

files
  id            uuid pk
  job_id        uuid fk -> jobs
  path          text
  language      text
  tier          text           -- A|B|C (analysis depth achieved)
  loc           int
  complexity    int
  churn         int null
  fan_in        int
  fan_out       int
  hotspot_score numeric
  start_score   numeric        -- "read this early" ranking
  summary       text null      -- LLM file summary
  summary_hash  text null      -- content hash for cache reuse

graph_nodes
  id            uuid pk
  job_id        uuid fk
  node_type     text           -- file | module | symbol | external_package
  ref_id        uuid null      -- fk to files when node_type=file
  label         text
  cluster_id    text null      -- which architecture module it belongs to
  meta          jsonb          -- language-specific extras

graph_edges
  id            uuid pk
  job_id        uuid fk
  src_node_id   uuid fk -> graph_nodes
  dst_node_id   uuid fk -> graph_nodes
  edge_type     text           -- import | call | contains
  weight        int default 1

modules            -- architecture clusters
  id            uuid pk
  job_id        uuid fk
  cluster_id    text
  label         text
  summary       text null      -- LLM module summary
  file_count    int

repo_summaries
  job_id        uuid fk
  overview      text           -- LLM repo-level overview
  reading_order jsonb          -- ordered list of file ids + why
  mental_model  text

chat_messages      -- optional, for the Q&A feature
  id            uuid pk
  job_id        uuid fk
  role          text           -- user | assistant
  content       text
  citations     jsonb          -- file paths referenced
  created_at    timestamptz

llm_cache          -- content-hash cache to avoid re-spending
  summary_hash  text pk
  summary       text
  model         text
  created_at    timestamptz
```

Index `graph_edges(job_id, src_node_id)` and `(job_id, dst_node_id)`; index `files(job_id, start_score desc)` and `(job_id, hotspot_score desc)`.

---

## 7. Backend API (Node.js)

REST, JSON. SSE for progress. Suggested framework: **Fastify** (fast, good SSE + schema validation) or Express if you prefer familiarity.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/analyze` | Body `{ repoUrl, llmEnabled }`. Validates, de-dupes (same repo+commit → return existing), enqueues job, returns `jobId`. |
| GET | `/api/jobs/:id` | Job status + stage + progress. |
| GET | `/api/jobs/:id/events` | **SSE** stream of progress events. |
| GET | `/api/jobs/:id/overview` | Repo-level summary, reading order, metadata, language mix. |
| GET | `/api/jobs/:id/tree` | File tree + per-file metrics (for left rail). |
| GET | `/api/jobs/:id/graph?type=dependency\|call\|architecture` | Nodes + edges for a view (paginated / aggregated for big graphs). |
| GET | `/api/jobs/:id/modules/:clusterId` | Module summary + its files + intra-module edges. |
| GET | `/api/jobs/:id/files/:fileId` | File summary, metrics, imports/exports, neighbors. |
| POST | `/api/jobs/:id/chat` | Ask a question; returns answer + cited file paths. |
| GET | `/api/examples` | Pre-analyzed showcase repos for the landing page. |

**Rate limiting / abuse control:** per-IP limit on `POST /api/analyze`; a global concurrency cap on workers; a per-repo cooldown. This matters because anyone can submit any public repo and trigger expensive work.

---

## 8. Tech Stack Summary

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | TS strongly recommended for a graph-heavy app. |
| Server state | TanStack Query | Caching + background refetch. |
| Graph viz | Cytoscape.js (+ React Flow for architecture) | Progressive disclosure to stay performant. |
| UI | Tailwind + a component kit (shadcn/ui) | Fast, clean, resume-grade polish. |
| Backend | Node.js + Fastify + TypeScript | REST + SSE. |
| Queue | BullMQ + Redis | Background analysis jobs. |
| Parsing | Tree-sitter + language adapters | The language-agnostic core. |
| LLM | Claude or GPT via API | Summaries + chat; cached by content hash. |
| DB | PostgreSQL + Prisma (or Drizzle) | Typed data access. |
| Object storage | S3 / MinIO | Big graph JSON + repo snapshots. |
| Git | system `git` + `simple-git` | Shallow/treeless clones. |
| Deploy | Docker Compose (local parity) → a host (Railway/Render/Fly/VPS) | Keep it reproducible. |
| Observability | pino logs + a basic metrics endpoint | Nice-to-have for the resume story. |

---

## 9. Build Roadmap (phased, each phase = a demoable milestone)

**Phase 0 — Scaffolding (foundation)**
- Monorepo (pnpm workspaces): `web`, `api`, `worker`, `shared`.
- Docker Compose: Postgres + Redis + MinIO + api + worker + web.
- Prisma schema + migrations for §6. CI lint/typecheck.
- *Milestone:* `docker compose up` boots the whole stack; health checks green.

**Phase 1 — Ingest & file inventory (no graphs yet)**
- `POST /api/analyze` → clone repo → file inventory → persist → job status via SSE.
- Frontend: URL input → progress page → a plain file tree with sizes.
- *Milestone:* paste a URL, watch it clone, see the file tree.

**Phase 2 — Dependency graph (the backbone)**
- Tree-sitter integration + JS/TS + Python adapters (imports only).
- Build dependency graph, persist nodes/edges, render with Cytoscape.
- Fan-in/fan-out metrics.
- *Milestone:* a real, interactive import graph for a JS and a Python repo.

**Phase 3 — Architecture map + hotspots**
- Directory-based clustering → module map (React Flow).
- LOC, complexity proxy, churn, hotspot score; heat-color the file tree.
- "Start here" ranking + reading order (pre-LLM, heuristic).
- *Milestone:* module overview + hotspots + suggested reading order.

**Phase 4 — LLM enrichment + chat**
- File → module → repo summaries (bottom-up, capped, cached).
- Context panel shows summaries; streaming into the UI.
- Ask-the-repo chat with cited paths.
- *Milestone:* plain-English overview + working Q&A.

**Phase 5 — Breadth & robustness**
- Add adapters: Java, Go, Ruby, C#. Implement Tier B (grammar-only) and Tier C (unknown) fallbacks.
- Call graph (best-effort) tab.
- Big-repo handling: aggregation, pagination, limits.
- *Milestone:* throw arbitrary repos at it; it never hard-fails.

**Phase 6 — Polish & ship (the resume layer)**
- Landing page with pre-analyzed showcase repos.
- Shareable URLs + OG preview images.
- Rate limiting, error states, empty states, loading skeletons.
- Deploy to a public host; write the README + architecture doc + a short demo video/GIF.
- *Milestone:* a live link you can put on your resume.

---

## 10. Hardest Problems (and how to approach them)

1. **Cross-file / cross-language call graph accuracy.** Perfect symbol resolution is a research problem. **Approach:** be honest — label it "best-effort," do solid intra-file resolution, approximate cross-file by matching call names to exported symbols within the same package, and lean on the dependency graph as the reliable view.
2. **"Any language" without writing 40 parsers.** **Approach:** the Tier A/B/C degradation ladder (§4.3). Tree-sitter gives you breadth; adapters give you depth only where it pays off.
3. **LLM cost blowup on large repos.** **Approach:** summarize bottom-up, cap files by importance score, truncate, and cache by content hash. Make LLM optional per job.
4. **Rendering huge graphs.** **Approach:** default to module level, drill down on demand, aggregate edges, consider WebGL for the big views.
5. **Monorepos / weird layouts.** **Approach:** detect multiple package roots (`package.json`, `go.mod`, `pyproject.toml`, `pom.xml`) and treat each as a sub-project; let the user switch between them.
6. **Abuse / cost of a public endpoint.** **Approach:** rate limits, size caps, worker concurrency caps, and a de-dupe cache keyed on repo+commit so the same repo isn't re-analyzed.

---

## 11. Security & Safety

- **Untrusted code:** cloned repos are untrusted data. **Never execute** repo code, build scripts, or install its dependencies. Parsing is static (Tree-sitter reads text — it does not run anything). Run clone + parse in a sandboxed worker with no outbound network beyond git+LLM+storage, constrained CPU/memory/disk, and a hard timeout.
- **Path traversal / zip bombs:** enforce file-count and total-size caps; ignore symlinks that escape the repo root.
- **Secrets:** don't surface or store obvious secrets found in repos; strip them from LLM prompts where detectable.
- **LLM prompt hygiene:** treat file contents as data, not instructions (a repo could contain adversarial text aimed at the summarizer). Wrap repo content clearly and instruct the model to ignore embedded instructions.
- **No PII beyond public GitHub metadata.** Public repos only means no auth secrets to protect in v1.

---

## 12. Testing & Quality

- **Unit:** language adapters against fixture repos (small, hand-checked import/def sets).
- **Golden repos:** a handful of known open-source repos with expected top-level structure; snapshot the module map + key metrics and alert on drift.
- **Pipeline resumability:** kill the worker mid-stage; confirm the job resumes/retries cleanly.
- **Load:** submit a 2,000-file repo; confirm time budget and graph render performance.
- **Degradation:** submit an unknown-language repo; confirm Tier C output renders.

---

## 13. Stretch Goals (post-v1, resume bonus)

- GitHub OAuth → private repos.
- Embeddings-based RAG for much better chat.
- "Diff two commits" — how did the architecture change.
- PR-ready onboarding doc export (Markdown).
- VS Code extension that opens the file when you click a node.
- Multi-repo / dependency-of-dependency view.

---

## 14. What Makes This Resume-Strong

- **Distributed system shape:** API + queue + worker + DB + object storage — not a toy CRUD app.
- **Real algorithms:** graph construction, clustering, complexity/hotspot scoring.
- **LLM engineering with cost discipline:** bottom-up summarization, caching, retrieval — not just "call the API."
- **Language-agnostic design** via a clean adapter pattern and graceful degradation.
- **A live, shareable demo** — the single most persuasive thing on a portfolio.

Lead the README with a GIF of pasting a URL and watching the architecture map build. That one image does more than a page of bullet points.
