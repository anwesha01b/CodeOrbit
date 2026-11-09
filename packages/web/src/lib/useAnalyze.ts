import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeRepo } from "./api";

/** Submit a repo URL, then route to the live progress (or straight to a cached result). */
export function useAnalyze() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(repoUrl: string): Promise<void> {
    const url = repoUrl.trim();
    if (!url || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { jobId, deduped } = await analyzeRepo(url);
      navigate(deduped ? `/r/${jobId}` : `/analyzing/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return { submit, loading, error };
}
