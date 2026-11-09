import type { ExampleRepo } from "@codeorbit/shared";

/**
 * Pre-analyzed showcase repos for the landing page "live repo cards".
 * Static for now (Phase 0); Phase 6 swaps these for real pre-analyzed jobs
 * so the portfolio link never shows a cold/slow first impression.
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
    owner: "fastapi",
    name: "fastapi",
    description: "High-performance web framework for building APIs with Python.",
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
    owner: "rails",
    name: "rails",
    description: "Full-stack web framework optimized for developer happiness.",
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
    description: "Cross-platform .NET framework for building web apps.",
    language: "C#",
    stars: 36000,
    files: 5210,
    modules: 52,
    hotspots: 71,
    accent: "amber",
  },
];
