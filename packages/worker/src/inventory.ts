import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "vendor", "dist", "build", ".next", "out", "target",
  "__pycache__", ".venv", "venv", ".turbo", "coverage", ".idea", ".vscode", "bin", "obj",
]);

const IGNORE_FILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock",
  "Cargo.lock", "composer.lock", "go.sum", "Gemfile.lock",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz",
  ".tar", ".tgz", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".mp3", ".wav",
  ".mov", ".avi", ".bin", ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".wasm",
  ".map", ".lock", ".pdf", ".psd", ".sketch",
]);

const LANG: Record<string, string> = {
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".java": "Java", ".cs": "C#",
  ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".rs": "Rust",
  ".php": "PHP", ".swift": "Swift", ".kt": "Kotlin", ".scala": "Scala", ".sh": "Shell",
  ".yml": "YAML", ".yaml": "YAML", ".json": "JSON", ".md": "Markdown", ".html": "HTML",
  ".css": "CSS", ".scss": "SCSS", ".less": "Less", ".sql": "SQL", ".vue": "Vue",
  ".svelte": "Svelte", ".toml": "TOML", ".xml": "XML", ".graphql": "GraphQL",
};

export interface InventoryFile {
  path: string;
  language: string | null;
  loc: number;
}

const MAX_FILE_BYTES = 1_000_000; // skip files > 1 MB (generated / vendored)

/** Walk the working set, applying ignore rules, and return path + language + LOC. */
export async function buildInventory(root: string, maxFiles: number): Promise<InventoryFile[]> {
  const out: InventoryFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.isSymbolicLink()) continue; // never follow symlinks (escape guard)
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (IGNORE_FILES.has(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      if (/\.min\.(js|css)$/i.test(entry.name)) continue;

      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_BYTES) continue;

      const loc = await countLines(full);
      if (loc < 0) continue; // binary content

      out.push({
        path: path.relative(root, full).split(path.sep).join("/"),
        language: LANG[ext] ?? null,
        loc,
      });
    }
  }

  await walk(root);
  return out;
}

/** Line count, or -1 if the file looks binary (contains a null byte). */
async function countLines(file: string): Promise<number> {
  const buf = await fs.readFile(file);
  if (buf.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return -1;
    if (buf[i] === 10) lines++;
  }
  return lines;
}
