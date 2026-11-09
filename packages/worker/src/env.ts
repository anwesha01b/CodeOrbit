import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env regardless of which directory the process starts in.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  workspaceDir: path.resolve(process.env.WORKSPACE_DIR ?? "./.workspaces"),
  maxFiles: Number(process.env.MAX_REPO_FILES ?? 15000),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  // Clone this many commits deep so churn (commits-per-file) is meaningful.
  cloneDepth: Number(process.env.CLONE_DEPTH ?? 200),
};
