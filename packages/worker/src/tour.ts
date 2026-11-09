import type { PrismaClient, Prisma } from "@prisma/client";
import { layerOf, pathKind, NON_CODE_LANGUAGES, type Layer, type TourStep } from "@codeorbit/shared";

/** Request-flow order: what you meet first when following a call into the system. */
const LAYER_ORDER: Layer[] = [
  "Core", "API", "Service", "Security", "Middleware", "Data", "External", "Background", "UI", "Utility", "Config",
];

const LAYER_BLURB: Record<Layer, string> = {
  Core: "The central abstractions everything else is built around.",
  API: "How requests enter the system: routes, handlers and endpoints.",
  Service: "Business logic that the entry points delegate to.",
  Security: "Authentication, authorization and credential handling.",
  Middleware: "Code that wraps every request — cross-cutting concerns.",
  Data: "Models, schemas and persistence.",
  External: "Adapters and clients for outside services.",
  Background: "Workers, queues and scheduled jobs.",
  UI: "User-facing components and views.",
  Utility: "Shared helpers the rest of the code leans on.",
  Config: "Configuration and settings.",
  Test: "Tests.",
  Docs: "Documentation.",
  Examples: "Examples.",
};

const MAX_FILES = 16;
const PER_STEP = 3;
const MAX_STEPS = 8;

/**
 * Heuristic guided tour (after Understand-Anything's tour generator): start at the most
 * load-bearing entry point, then walk the important product files grouped by layer in
 * request-flow order. The AI step later rewrites titles/descriptions when available.
 */
export async function buildHeuristicTour(prisma: PrismaClient, jobId: string): Promise<TourStep[]> {
  const files = await prisma.file.findMany({
    where: { jobId },
    select: { path: true, fanIn: true, language: true },
    orderBy: { startScore: "desc" },
    take: 500,
  });
  // product code only: dotfiles and markers like py.typed classify as "source" by path
  const isCode = (f: { path: string; language: string | null }) =>
    pathKind(f.path) === "source" && !!f.language && !NON_CODE_LANGUAGES.has(f.language);
  const source = files.filter(isCode).slice(0, MAX_FILES);
  if (source.length === 0) return [];

  const [entry, ...rest] = source;
  const steps: TourStep[] = [
    {
      title: "Start at the entry point",
      description: `${entry.path} is the most load-bearing entry into the codebase${
        entry.fanIn ? ` — ${entry.fanIn} files depend on it` : ""
      }. Read it first to see what the project exposes.`,
      files: [entry.path],
    },
  ];

  const byLayer = new Map<Layer, string[]>();
  for (const f of rest) {
    const layer = layerOf(f.path);
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), f.path]);
  }
  for (const layer of LAYER_ORDER) {
    const list = byLayer.get(layer) ?? [];
    for (let i = 0; i < list.length; i += PER_STEP) {
      const part = list.length > PER_STEP ? ` (${i / PER_STEP + 1})` : "";
      steps.push({ title: `${layer} layer${part}`, description: LAYER_BLURB[layer], files: list.slice(i, i + PER_STEP) });
    }
  }
  return steps.slice(0, MAX_STEPS);
}

/** Store the tour without disturbing an existing AI overview. */
export async function saveTour(prisma: PrismaClient, jobId: string, steps: TourStep[]): Promise<void> {
  const readingOrder = steps as unknown as Prisma.InputJsonValue;
  await prisma.repoSummary.upsert({
    where: { jobId },
    update: { readingOrder },
    create: { jobId, readingOrder },
  });
}
