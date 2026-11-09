import path from "node:path";
import { promises as fs } from "node:fs";
import PgBoss from "pg-boss";
import pino from "pino";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { shallowClone } from "./clone.js";
import { buildInventory } from "./inventory.js";
import { getProvider } from "@codeorbit/shared/llm";
import { buildDependencyGraph, persistGraph, persistCallGraph } from "./graph.js";
import { computeMetrics } from "./metrics.js";
import { runLlmEnrichment } from "./llm.js";
import { buildHeuristicTour, saveTour } from "./tour.js";
import { scanTodos } from "./todos.js";

const log = pino({ name: "worker" });
const QUEUE = "analyze";

interface AnalyzeJob {
  jobId: string;
  repoUrl: string;
  branch: string;
  llmEnabled: boolean;
}

async function runJob(data: AnalyzeJob): Promise<void> {
  const dir = path.join(env.workspaceDir, data.jobId);
  try {
    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: "cloning", stage: "Cloning repository", progressPct: 15 },
    });

    const sha = await shallowClone(data.repoUrl, data.branch, dir, env.cloneDepth);

    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: "parsing", stage: "Indexing files", progressPct: 55, commitSha: sha },
    });

    const files = await buildInventory(dir, env.maxFiles);
    if (files.length > 0) {
      await prisma.file.createMany({
        data: files.map((f) => ({
          jobId: data.jobId,
          path: f.path,
          language: f.language,
          loc: f.loc,
        })),
      });
    }

    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: "graphing", stage: "Building dependency graph", progressPct: 80 },
    });

    const fileRows = await prisma.file.findMany({
      where: { jobId: data.jobId },
      select: { id: true, path: true, language: true },
    });
    const fileSet = new Set(fileRows.map((f) => f.path));
    const fileIdByPath = new Map(fileRows.map((f) => [f.path, f.id]));
    const graph = await buildDependencyGraph(dir, fileRows, fileSet);
    await persistGraph(prisma, data.jobId, graph, fileIdByPath);
    await persistCallGraph(prisma, data.jobId, graph, fileIdByPath);

    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: "metrics", stage: "Scoring hotspots & modules", progressPct: 90 },
    });
    const moduleCount = await computeMetrics(prisma, data.jobId, dir, fileRows, graph, env.cloneDepth);
    // heuristic guided tour always exists; the AI pass may re-narrate it
    await saveTour(prisma, data.jobId, await buildHeuristicTour(prisma, data.jobId));
    // contribution opportunities in the code itself (non-fatal)
    await scanTodos(prisma, data.jobId, dir, fileRows).catch((err) =>
      log.warn({ jobId: data.jobId, err: String(err) }, "TODO scan failed; continuing"),
    );

    if (data.llmEnabled) {
      const provider = getProvider();
      if (await provider.isAvailable()) {
        await prisma.job.update({
          where: { id: data.jobId },
          data: { status: "llm", stage: "Generating summaries & embeddings", progressPct: 95 },
        });
        try {
          const result = await runLlmEnrichment(prisma, data.jobId, dir, provider, async (stage) => {
            await prisma.job.update({ where: { id: data.jobId }, data: { stage } }).catch(() => undefined);
          });
          log.info(
            { jobId: data.jobId, summaries: result.summaries, modules: result.modules, chunks: result.chunks, cacheHits: result.cacheHits, errors: result.errors.length },
            "AI enrichment finished",
          );
          if (result.errors.length) log.warn({ jobId: data.jobId, errors: result.errors.slice(0, 5) }, "AI enrichment had partial failures");
        } catch (err) {
          log.warn({ jobId: data.jobId, err: String(err) }, "AI enrichment failed; continuing");
        }
      } else {
        log.info({ jobId: data.jobId, provider: provider.name }, "LLM provider unavailable — skipping");
      }
    }

    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: "complete", stage: "Complete", progressPct: 100, finishedAt: new Date() },
    });
    log.info(
      {
        jobId: data.jobId,
        files: files.length,
        nodes: graph.fileNodes.size,
        externals: graph.externals.size,
        modules: moduleCount,
      },
      "analysis complete",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ jobId: data.jobId, err: message }, "job failed");
    await prisma.job
      .update({
        where: { id: data.jobId },
        data: { status: "failed", stage: "Failed", error: message, finishedAt: new Date() },
      })
      .catch(() => undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (!env.databaseUrl) {
    log.error("DATABASE_URL is not set — cannot start worker.");
    process.exit(1);
  }

  const boss = new PgBoss({ connectionString: env.databaseUrl });
  boss.on("error", (err) => log.error(err));
  await boss.start();
  await boss.createQueue(QUEUE);

  // Retrieval is always scoped to one job (≤ a few hundred chunks), so an exact scan via the
  // job_id index is fast and correct. A global HNSW index would return the nearest chunks
  // across *all* jobs and then filter by job_id, which can silently return nothing.
  await prisma.$executeRawUnsafe("DROP INDEX IF EXISTS code_chunks_embedding_idx").catch(() => undefined);

  await boss.work<AnalyzeJob>(QUEUE, { batchSize: env.concurrency }, async ([job]) => {
    log.info({ jobId: job.data.jobId, repoUrl: job.data.repoUrl }, "picked up job");
    await runJob(job.data);
  });

  log.info(`worker ready on queue "${QUEUE}" (concurrency=${env.concurrency})`);
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
