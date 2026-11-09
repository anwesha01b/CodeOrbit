import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { pathKind, NON_CODE_LANGUAGES } from "@codeorbit/shared";

/** A marker inside a comment: `# TODO: …`, `// FIXME(bob) …`, `/* HACK …`, `* XXX …`. */
const MARKER = /(?:#|\/\/|\/\*|^\s*\*|<!--|--|;)\s*(TODO|FIXME|HACK|XXX|BUG)\b[\s:(\-–]*(?:[\w.@-]+\)\s*[:\-–]?\s*)?(.*)$/;
const MAX_PER_JOB = 400;
const MAX_FILE_BYTES = 512 * 1024;

interface FileRow {
  path: string;
  language: string | null;
}

/**
 * Collect TODO-style markers from code (not docs) so they can be offered as contribution
 * tasks. Bounded per job; a file that can't be read is skipped.
 */
export async function scanTodos(prisma: PrismaClient, jobId: string, root: string, files: FileRow[]): Promise<number> {
  const found: { jobId: string; path: string; line: number; tag: string; text: string }[] = [];
  for (const f of files) {
    if (found.length >= MAX_PER_JOB) break;
    const kind = pathKind(f.path);
    if ((kind !== "source" && kind !== "test") || !f.language || NON_CODE_LANGUAGES.has(f.language)) continue;
    let text: string;
    try {
      const abs = path.join(root, f.path);
      if ((await fs.stat(abs)).size > MAX_FILE_BYTES) continue;
      text = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && found.length < MAX_PER_JOB; i++) {
      const m = MARKER.exec(lines[i]);
      if (!m) continue;
      const body = m[2].replace(/\*\/\s*$|-->\s*$/, "").trim();
      if (body.length < 4) continue; // bare "TODO" carries no task
      found.push({ jobId, path: f.path, line: i + 1, tag: m[1], text: body.slice(0, 240) });
    }
  }
  if (found.length) await prisma.codeTodo.createMany({ data: found });
  return found.length;
}
