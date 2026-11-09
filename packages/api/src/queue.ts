import PgBoss from "pg-boss";
import { env } from "./env.js";

export const ANALYZE_QUEUE = "analyze";

let boss: PgBoss | null = null;

/** Lazily start one pg-boss instance and ensure the analyze queue exists. */
export async function getQueue(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({ connectionString: env.databaseUrl });
    await boss.start();
    await boss.createQueue(ANALYZE_QUEUE);
  }
  return boss;
}
