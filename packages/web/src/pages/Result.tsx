import { useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Folder, FileCode2, ArrowLeft, Loader2, FolderTree, Network, LayoutGrid, Boxes, MessageSquare, GitFork, GitPullRequest, GraduationCap } from "lucide-react";
import { CodeDrawerProvider, useOpenCode } from "../components/CodeDrawer";
import { DetailProvider, useDetail } from "../lib/detail";
import { ContributeView } from "../components/ContributeView";
import type { FileEntry } from "@codeorbit/shared";
import { Wordmark } from "../components/Logo";
import { DependencyView } from "../components/DependencyView";
import { ArchitectureView } from "../components/ArchitectureView";
import { OverviewView, GenerateAiCard } from "../components/OverviewView";
import { ChatDrawer } from "../components/ChatDrawer";
import { LANGUAGE_DOT } from "../data/exampleRepos";
import { fetchTree, fetchOverview } from "../lib/api";

type View = "overview" | "architecture" | "deps" | "call" | "files" | "contribute";
const VIEWS: View[] = ["overview", "architecture", "deps", "call", "files", "contribute"];

function heatColor(score: number, max: number): string | null {
  if (score <= 0) return null;
  const r = score / max;
  if (r >= 0.66) return "#f0883e";
  if (r >= 0.33) return "#e3a008";
  return "#3fb950";
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: (FileEntry & { full: string })[];
  loc: number;
}

function buildTree(files: FileEntry[]): Dir {
  const root: Dir = { name: "", dirs: new Map(), files: [], loc: 0 };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    node.loc += f.loc;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, dirs: new Map(), files: [], loc: 0 });
      node = node.dirs.get(seg)!;
      node.loc += f.loc;
    }
    node.files.push({ ...f, full: f.path, path: parts[parts.length - 1] });
  }
  return root;
}

function DirView({ dir, depth, maxHot }: { dir: Dir; depth: number; maxHot: number }) {
  const openCode = useOpenCode();
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {dirs.map((d) => (
        <details key={d.name} open={depth < 1} className="group">
          <summary
            className="flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 font-mono text-[13px] text-fg-2 hover:bg-sunken"
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <Folder size={13} className="shrink-0 text-accent-soft" />
            <span className="truncate">{d.name}</span>
            <span className="ml-auto shrink-0 pl-2 font-sans text-[11px] tabular-nums text-subtle">
              {d.loc.toLocaleString()}
            </span>
          </summary>
          <DirView dir={d} depth={depth + 1} maxHot={maxHot} />
        </details>
      ))}
      {files.map((f) => {
        const hc = heatColor(f.hotspotScore, maxHot);
        return (
        <button
          key={f.path}
          onClick={() => openCode({ path: f.full })}
          title={`Read ${f.full}`}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[13px] text-muted hover:bg-sunken hover:text-fg"
          style={{ paddingLeft: 8 + depth * 16 + 15 }}
        >
          <FileCode2 size={13} className="shrink-0 text-subtle" />
          <span className="truncate">{f.path}</span>
          {f.language && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: LANGUAGE_DOT[f.language] ?? "#6b7280" }}
              title={f.language}
            />
          )}
          {hc && (
            <span
              className="ml-auto h-2 w-2 shrink-0 rounded-full"
              style={{ background: hc }}
              title={`hotspot ${f.hotspotScore}`}
            />
          )}
          <span
            className={`${hc ? "" : "ml-auto"} shrink-0 pl-2 font-sans text-[11px] tabular-nums text-subtle`}
          >
            {f.loc.toLocaleString()}
          </span>
        </button>
        );
      })}
    </>
  );
}

export function Result() {
  const { jobId } = useParams<{ jobId: string }>();
  // the open tab lives in the URL (?tab=architecture) so every view can be linked and shared
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.includes(params.get("tab") as View) ? (params.get("tab") as View) : "overview";
  const setView = (v: View) => setParams(v === "overview" ? {} : { tab: v }, { replace: true });
  const [chatOpen, setChatOpen] = useState(false);
  const openFromChat = useRef<((t: { path: string; line?: number; title?: string }) => void) | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["tree", jobId],
    queryFn: () => fetchTree(jobId!),
    enabled: !!jobId,
  });
  // shared cache with the Overview tab — tells the chatbot whether an AI index exists
  const { data: overview } = useQuery({
    queryKey: ["overview", jobId],
    queryFn: () => fetchOverview(jobId!),
    enabled: !!jobId,
  });
  const chatNotice = !overview || overview.indexedChunks > 0 ? undefined : overview.llmReady ? (
    <GenerateAiCard repo={`${overview.owner}/${overview.name}`} failed={overview.aiEnabled} />
  ) : (
    <p className="rounded border border-line bg-sunken p-3 text-[13px] text-muted">
      The chatbot needs an LLM provider. Add <span className="font-mono text-fg-2">GEMINI_API_KEY</span> to .env and
      re-analyze.
    </p>
  );

  return (
    <DetailProvider>
    <CodeDrawerProvider jobId={jobId!}>
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="container-rl flex h-16 items-center justify-between">
          <Link to="/" aria-label="CodeOrbit home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <BeginnerSwitch />
            <button onClick={() => setChatOpen(true)} className="btn-primary h-9 whitespace-nowrap px-3 py-0" aria-label="Ask the repo">
              <MessageSquare size={15} /> <span className="hidden sm:inline">Ask the repo</span>
            </button>
            <Link to="/" className="btn-ghost h-9 whitespace-nowrap px-3 py-0" aria-label="New analysis">
              <ArrowLeft size={15} /> <span className="hidden sm:inline">New analysis</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="container-rl py-10">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin" /> Loading inventory…
          </div>
        )}
        {error && <p className="text-red-600">Couldn’t load this result.</p>}

        {data && (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-mono text-2xl font-semibold text-fg">
                  {data.owner}/{data.name}
                </h1>
                <p className="mt-1 text-sm text-muted">Structure, modules &amp; hotspots</p>
              </div>
              <div className="flex gap-6 text-sm">
                <Stat label="files" value={data.totalFiles.toLocaleString()} />
                <Stat label="lines of code" value={data.totalLoc.toLocaleString()} />
              </div>
            </div>

            <div className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto border-b border-line">
              <TabButton active={view === "overview"} onClick={() => setView("overview")} icon={LayoutGrid}>
                Overview
              </TabButton>
              <TabButton active={view === "architecture"} onClick={() => setView("architecture")} icon={Boxes}>
                Architecture
              </TabButton>
              <TabButton active={view === "deps"} onClick={() => setView("deps")} icon={Network}>
                Dependencies
              </TabButton>
              <TabButton active={view === "call"} onClick={() => setView("call")} icon={GitFork}>
                Call graph
              </TabButton>
              <TabButton active={view === "files"} onClick={() => setView("files")} icon={FolderTree}>
                Files
              </TabButton>
              <TabButton active={view === "contribute"} onClick={() => setView("contribute")} icon={GitPullRequest}>
                Contribute
              </TabButton>
            </div>

            {view === "overview" && <OverviewView jobId={jobId!} />}
            {view === "contribute" && <ContributeView jobId={jobId!} />}
            {view === "architecture" && (
              <div className="card overflow-hidden">
                <ArchitectureView jobId={jobId!} />
              </div>
            )}
            {view === "deps" && (
              <div className="card overflow-hidden">
                <DependencyView jobId={jobId!} />
              </div>
            )}
            {view === "call" && (
              <div className="card overflow-hidden">
                <DependencyView jobId={jobId!} graphType="call" />
              </div>
            )}
            {view === "files" && (
              <div className="card max-w-3xl p-2">
                {data.files.length === 0 ? (
                  <p className="p-4 text-sm text-muted">No source files were indexed.</p>
                ) : (
                  <DirView
                    dir={buildTree(data.files)}
                    depth={0}
                    maxHot={Math.max(1, ...data.files.map((f) => f.hotspotScore))}
                  />
                )}
              </div>
            )}

          </>
        )}
      </main>
      <ChatDrawer
        jobId={jobId!}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        notice={chatNotice}
        onCitation={(path, line) => {
          setChatOpen(false);
          openFromChat.current?.({ path, line: line || undefined, title: "Cited in the answer" });
        }}
      />
      <CodeBridge into={openFromChat} />
    </div>
    </CodeDrawerProvider>
    </DetailProvider>
  );
}

/** lets the page (outside the provider) open code: the provider exposes its opener through a ref */
function CodeBridge({ into }: { into: React.MutableRefObject<((t: { path: string; line?: number; title?: string }) => void) | null> }) {
  into.current = useOpenCode();
  return null;
}

function BeginnerSwitch() {
  const { beginner, setBeginner } = useDetail();
  return (
    <button
      role="switch"
      aria-checked={beginner}
      onClick={() => setBeginner(!beginner)}
      title={beginner ? "Explanations are on. Turn off for a quieter view." : "Explanations are off. Turn on for plain-English help."}
      className="hidden h-9 items-center gap-2 rounded-md border border-line px-2.5 text-[12.5px] text-fg-2 transition-colors hover:border-line-strong md:flex"
    >
      <GraduationCap size={14} aria-hidden />
      Beginner mode
      <span className={`relative h-4 w-7 rounded-full transition-colors ${beginner ? "bg-fg" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] ${beginner ? "left-[14px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FolderTree;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-accent text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      <Icon size={14} /> {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-xl font-semibold text-fg">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  );
}
