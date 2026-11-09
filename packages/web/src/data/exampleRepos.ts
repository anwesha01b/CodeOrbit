import type { ExampleRepo } from "@codeorbit/shared";

/**
 * Local copy so the landing page renders instantly with no API round-trip
 * (the API serves the same list at /api/examples). Phase 6 replaces these
 * with real pre-analyzed jobs that deep-link into the dashboard.
 */
export const EXAMPLE_REPOS: ExampleRepo[] = [
  {
    owner: "facebook",
    name: "react",
    description: "The library for web and native user interfaces.",
    language: "JavaScript",
    stars: 231000,
    files: 1842,
    modules: 24,
    hotspots: 37,
    accent: "sky",
  },
  {
    owner: "vercel",
    name: "next.js",
    description: "The React framework for the web.",
    language: "TypeScript",
    stars: 128000,
    files: 3920,
    modules: 41,
    hotspots: 58,
    accent: "blue",
  },
  {
    owner: "fastapi",
    name: "fastapi",
    description: "High-performance API framework for Python.",
    language: "Python",
    stars: 78000,
    files: 612,
    modules: 11,
    hotspots: 19,
    accent: "emerald",
  },
  {
    owner: "gin-gonic",
    name: "gin",
    description: "HTTP web framework written in Go.",
    language: "Go",
    stars: 79000,
    files: 214,
    modules: 7,
    hotspots: 12,
    accent: "cyan",
  },
  {
    owner: "rails",
    name: "rails",
    description: "Full-stack framework for developer happiness.",
    language: "Ruby",
    stars: 56000,
    files: 2871,
    modules: 29,
    hotspots: 44,
    accent: "rose",
  },
  {
    owner: "dotnet",
    name: "aspnetcore",
    description: "Cross-platform .NET web framework.",
    language: "C#",
    stars: 36000,
    files: 5210,
    modules: 52,
    hotspots: 71,
    accent: "amber",
  },
];

export const LANGUAGE_DOT: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Go: "#00ADD8",
  Ruby: "#701516",
  "C#": "#178600",
};
