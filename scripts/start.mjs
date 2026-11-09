// Production entry point: one container runs the API (which also serves the web app) and the worker.
//   1. apply the Prisma schema to the database (idempotent; set SKIP_DB_PUSH=1 to skip)
//   2. start the API and the worker; if either exits, stop the other so the platform restarts the service
import { spawn, spawnSync } from "node:child_process";

const shell = process.platform === "win32";
const run = (args, opts = {}) => spawn("pnpm", args, { stdio: "inherit", shell, ...opts });

if (!process.env.SKIP_DB_PUSH) {
  const push = spawnSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], { stdio: "inherit", shell });
  if (push.status !== 0) {
    console.error("prisma db push failed — check DATABASE_URL");
    process.exit(push.status ?? 1);
  }
}

const children = [
  run(["--filter", "@codeorbit/api", "exec", "tsx", "src/server.ts"]),
  run(["--filter", "@codeorbit/worker", "exec", "tsx", "src/index.ts"]),
];

let stopping = false;
const stopAll = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
};
for (const c of children) c.on("exit", (code) => stopAll(code ?? 1));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => stopAll(0));
