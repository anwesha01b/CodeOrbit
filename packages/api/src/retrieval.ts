import { prisma } from "./db.js";

export interface RetrievedChunk {
  path: string | null;
  content: string;
  startLine: number | null;
  endLine: number | null;
  chunkType: string;
}

/** Hybrid retrieval: pgvector similarity + a keyword/path match, merged and de-duped. */
export async function retrieve(
  jobId: string,
  question: string,
  qvec: number[],
  k = 8,
): Promise<RetrievedChunk[]> {
  const literal = `[${qvec.join(",")}]`;

  const vec = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT f.path AS "path", c.content AS "content",
           c.start_line AS "startLine", c.end_line AS "endLine", c.chunk_type AS "chunkType"
    FROM code_chunks c LEFT JOIN files f ON f.id = c.file_id
    WHERE c.job_id = ${jobId}::uuid
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${k}`;

  // keyword/path match for exact-identifier questions (regex-safe terms only)
  const terms = (question.match(/[A-Za-z0-9_./-]{3,}/g) ?? [])
    .filter((t) => !STOP.has(t.toLowerCase()))
    .slice(0, 6);
  let kw: RetrievedChunk[] = [];
  if (terms.length) {
    const pattern = terms.join("|");
    kw = await prisma.$queryRaw<RetrievedChunk[]>`
      SELECT f.path AS "path", c.content AS "content",
             c.start_line AS "startLine", c.end_line AS "endLine", c.chunk_type AS "chunkType"
      FROM code_chunks c LEFT JOIN files f ON f.id = c.file_id
      WHERE c.job_id = ${jobId}::uuid AND (c.content ~* ${pattern} OR f.path ~* ${pattern})
      LIMIT 4`;
  }

  const seen = new Set<string>();
  const merged: RetrievedChunk[] = [];
  for (const r of [...vec, ...kw]) {
    const key = `${r.path ?? ""}:${r.startLine ?? ""}:${r.content.slice(0, 40)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }
  return merged.slice(0, 10);
}

const STOP = new Set(["the", "and", "how", "what", "where", "does", "this", "that", "with", "for", "are", "repo"]);
