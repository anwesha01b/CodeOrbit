import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env regardless of which directory the process starts in.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

export const env = {
  // hosting platforms (Render, Railway, Fly…) assign the port through PORT
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
};
