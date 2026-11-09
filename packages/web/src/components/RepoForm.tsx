import { useId, useState } from "react";
import { ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { useAnalyze } from "../lib/useAnalyze";

const EXAMPLES = ["fastapi/fastapi", "pallets/click", "gin-gonic/gin", "expressjs/express"];

/** The one main action: paste a public repository URL and analyze it. Used in the hero and the close. */
export function RepoForm({ examples = true, autoFocus = false }: { examples?: boolean; autoFocus?: boolean }) {
  const [url, setUrl] = useState("");
  const { submit, loading, error } = useAnalyze();
  const id = useId();
  const errId = `${id}-err`;

  return (
    <div className="w-full max-w-xl">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit(url);
        }}
      >
        <label htmlFor={id} className="sr-only">
          GitHub repository URL
        </label>
        <input
          id={id}
          value={url}
          autoFocus={autoFocus}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="github.com/owner/repository"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? errId : undefined}
          className="h-12 w-full shrink-0 rounded-md sm:flex-1 border border-line-strong bg-surface px-4 font-mono text-[14px] text-fg shadow-card
            transition-colors placeholder:text-faint focus:border-fg focus:outline-none focus:ring-4 focus:ring-black/[0.06]"
        />
        <button type="submit" disabled={loading} className="btn-primary h-12 whitespace-nowrap px-5">
          {loading ? (
            <>
              Analyzing <Loader2 size={16} className="animate-spin" aria-hidden />
            </>
          ) : (
            <>
              Analyze repository <ArrowRight size={16} aria-hidden />
            </>
          )}
        </button>
      </form>

      {error && (
        <p id={errId} role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={15} aria-hidden /> {error}
        </p>
      )}

      {examples && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[13px] text-subtle">
          <span className="mr-1">Try</span>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setUrl(`github.com/${e}`)}
              className="rounded border border-line bg-sunken px-2 py-1 font-mono text-[12px] text-muted transition-colors hover:border-line-strong hover:bg-surface hover:text-fg"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
