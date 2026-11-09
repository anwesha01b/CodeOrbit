import type { Layer, PathKind } from "@codeorbit/shared";

/** Categorical palette for module/folder clusters (distinct on a dark ground). */
const PALETTE = [
  "#2563eb", "#16a34a", "#d97706", "#db2777", "#0891b2", "#65a30d",
  "#ea580c", "#0d9488", "#e11d48", "#ca8a04", "#0284c7", "#059669",
];

export function colorFor(cluster: string | null | undefined): string {
  if (!cluster) return "#71717a";
  let h = 0;
  for (let i = 0; i < cluster.length; i++) h = (h * 31 + cluster.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export const KIND_COLOR: Record<PathKind, string> = {
  source: "#2563eb",
  test: "#059669",
  example: "#ca8a04",
  docs: "#78716c",
  config: "#52525b",
};

export const KIND_LABEL: Record<PathKind, string> = {
  source: "source",
  test: "tests",
  example: "examples",
  docs: "docs",
  config: "tooling",
};

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Architectural roles, in request-flow order (top of a diagram → bottom). */
export const LAYER_ORDER: Layer[] = [
  "UI", "API", "Middleware", "Security", "Background", "Service", "Core",
  "Data", "External", "Utility", "Config", "Test", "Examples", "Docs",
];

export const LAYER_COLOR: Record<Layer, string> = {
  UI: "#db2777",
  API: "#2563eb",
  Middleware: "#0891b2",
  Security: "#e11d48",
  Background: "#65a30d",
  Service: "#16a34a",
  Core: "#0284c7",
  Data: "#d97706",
  External: "#ea580c",
  Utility: "#71717a",
  Config: "#52525b",
  Test: "#059669",
  Examples: "#ca8a04",
  Docs: "#78716c",
};

/** One plain-English line per role, for legends and tooltips. */
export const LAYER_HINT: Record<Layer, string> = {
  UI: "what users see: components, pages, views",
  API: "where requests come in: routes, handlers, endpoints",
  Middleware: "code that wraps every request",
  Security: "authentication, permissions, credentials",
  Background: "jobs, queues and scheduled work",
  Service: "business logic the entry points delegate to",
  Core: "the central building blocks of the project",
  Data: "models, schemas and storage",
  External: "talks to outside services and libraries",
  Utility: "shared helpers used everywhere",
  Config: "settings and configuration",
  Test: "tests",
  Examples: "example usage",
  Docs: "documentation",
};

export const layerColor = (l: Layer | undefined) => (l ? LAYER_COLOR[l] : "#71717a");
