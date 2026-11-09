import { useEffect, useRef, useState } from "react";
import { X, Send, Sparkles, Loader2 } from "lucide-react";
import type { Citation } from "@codeorbit/shared";
import { streamChat } from "../lib/api";
import { Markdown } from "./Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
}

const SUGGESTIONS = [
  "What does this repo do?",
  "Where is the entry point?",
  "How is the main data structure implemented?",
];

export function ChatDrawer({
  jobId,
  open,
  onClose,
  onCitation,
  notice,
}: {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onCitation: (path: string) => void;
  /** shown above the conversation, e.g. when the analysis has no AI index */
  notice?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: q, citations: [] }, { role: "assistant", content: "", citations: [] }]);

    try {
      await streamChat(jobId, q, sessionId.current, (ev) => {
        if (ev.type === "session") sessionId.current = ev.sessionId;
        else if (ev.type === "token") {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + ev.text };
            return next;
          });
        } else if (ev.type === "citations") {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { ...next[next.length - 1], citations: ev.citations };
            return next;
          });
        } else if (ev.type === "error") {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { ...next[next.length - 1], content: `⚠ ${ev.error}` };
            return next;
          });
        }
      });
    } catch (e) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { ...next[next.length - 1], content: `⚠ ${e instanceof Error ? e.message : "Chat failed"}` };
        return next;
      });
    } finally {
      // never leave a blank assistant bubble
      setMessages((m) => {
        const last = m[m.length - 1];
        if (!last || last.role !== "assistant" || last.content.trim()) return m;
        return [...m.slice(0, -1), { ...last, content: "⚠ No answer came back from the AI provider — please try again." }];
      });
      setBusy(false);
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-line bg-surface transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Sparkles size={15} className="text-accent-soft" /> Ask the repo
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close chat">
            <X size={16} />
          </button>
        </header>

        <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {notice}
          {messages.length === 0 && (
            <div className="text-sm text-muted">
              <p className="mb-3">Ask anything about this codebase — answers are grounded in the real code with cited files.</p>
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="block w-full rounded border border-line bg-sunken px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:border-accent/40 hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-lg rounded-br-sm bg-accent/15 px-3 py-2 text-[13px] text-fg"
                    : "max-w-full text-[13px] leading-relaxed text-fg-2"
                }
              >
                {m.content ? (
                  m.role === "assistant" ? <Markdown text={m.content} /> : m.content
                ) : busy && i === messages.length - 1 ? (
                  <Loader2 size={14} className="animate-spin text-subtle" />
                ) : null}
                {m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((c, j) => (
                      <button
                        key={j}
                        onClick={() => onCitation(c.path)}
                        className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-soft transition-colors hover:bg-accent/20"
                        title="Show file"
                      >
                        {c.path}
                        {c.startLine ? `:${c.startLine}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="border-t border-line p-3"
        >
          <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 focus-within:border-accent/50">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this repo…"
              className="flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
            />
            <button type="submit" disabled={busy || !input.trim()} className="text-accent-soft disabled:opacity-40" aria-label="Send">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
