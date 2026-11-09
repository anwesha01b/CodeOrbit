import { env } from "./env.js";

export interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
  sizeKb: number;
  stars: number;
  license: string | null;
  primaryLanguage: string | null;
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
  meta?: RepoMeta;
  commitSha?: string;
}

const MAX_SIZE_KB = 500 * 1024; // 500 MB cap (spec §0)

/** Extract owner/name from a github.com URL or an `owner/repo` shorthand. */
export function parseRepoUrl(input: string): { owner: string; name: string } | null {
  const cleaned = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i) ??
    cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "codeorbit",
  };
  if (env.githubToken) h.Authorization = `Bearer ${env.githubToken}`;
  return h;
}

/** Validate a public repo via the GitHub REST API and capture its metadata + HEAD sha. */
export async function validateRepo(owner: string, name: string): Promise<ValidateResult> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: ghHeaders() });
  } catch {
    return { ok: false, reason: "Could not reach GitHub" };
  }

  if (res.status === 404) return { ok: false, reason: "Repository not found" };
  if (res.status === 403) return { ok: false, reason: "GitHub rate limit reached — try again later" };
  if (!res.ok) return { ok: false, reason: `GitHub returned ${res.status}` };

  const data = (await res.json()) as Record<string, any>;
  if (data.private) return { ok: false, reason: "Private repositories are not supported" };
  if (typeof data.size === "number" && data.size > MAX_SIZE_KB) {
    return { ok: false, reason: "Repository exceeds the 500 MB size cap" };
  }

  const defaultBranch: string = data.default_branch ?? "main";
  const meta: RepoMeta = {
    owner: data.owner?.login ?? owner,
    name: data.name ?? name,
    defaultBranch,
    sizeKb: data.size ?? 0,
    stars: data.stargazers_count ?? 0,
    license: data.license?.spdx_id ?? null,
    primaryLanguage: data.language ?? null,
  };

  let commitSha: string | undefined;
  try {
    const c = await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${defaultBranch}`,
      { headers: ghHeaders() },
    );
    if (c.ok) commitSha = ((await c.json()) as Record<string, any>).sha;
  } catch {
    // commit sha is best-effort; the worker also records it after cloning
  }

  return { ok: true, meta, commitSha };
}
