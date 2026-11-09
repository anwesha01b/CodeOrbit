import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown for chat answers: headings, bullet/numbered lists, paragraphs,
 * fenced code, **bold**, `code` and [n] citation markers. Builds React nodes (no HTML
 * injection), so model output can never inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="ml-4 list-decimal space-y-1">{items}</ol>
      ) : (
        <ul key={blocks.length} className="ml-4 list-disc space-y-1">{items}</ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push(
        <pre key={blocks.length} className="overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11.5px] text-fg-2">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (heading) {
      flushPara();
      flushList();
      blocks.push(<p key={blocks.length} className="pt-1 font-semibold text-fg">{inline(heading[1])}</p>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+(?:,\s*\d+)*\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={out.length} className="font-semibold text-fg">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(<code key={out.length} className="rounded bg-black/[0.04] px-1 font-mono text-[11.5px] text-fg">{tok.slice(1, -1)}</code>);
    else out.push(<sup key={out.length} className="text-[10px] text-accent-soft">{tok}</sup>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
