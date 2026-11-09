import { promises as fs } from "node:fs";
import { simpleGit } from "simple-git";

/**
 * Stage 1 — shallow clone the default branch into `dest` and return the HEAD sha.
 * Untrusted code: we only read files, never run anything from the repo.
 */
export async function shallowClone(
  repoUrl: string,
  branch: string,
  dest: string,
  depth = 1,
): Promise<string> {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await simpleGit().clone(repoUrl, dest, [
    "--depth",
    String(depth),
    "--single-branch",
    "--branch",
    branch,
  ]);
  const head = await simpleGit(dest).revparse(["HEAD"]);
  return head.trim();
}
