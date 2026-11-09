import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Beginner mode (after Understand-Anything's persona levels): on by default, it shows plain-English
 * explanations, concept notes and open guides; off gives experienced readers a quieter screen.
 * Remembered per browser; storage failures just fall back to the default.
 */
const KEY = "codeorbit:beginner";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

const Ctx = createContext<{ beginner: boolean; setBeginner: (v: boolean) => void }>({ beginner: true, setBeginner: () => undefined });

export function DetailProvider({ children }: { children: ReactNode }) {
  const [beginner, set] = useState(read);
  const setBeginner = (v: boolean) => {
    set(v);
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {
      /* private mode: keep it for this visit only */
    }
  };
  return <Ctx.Provider value={{ beginner, setBeginner }}>{children}</Ctx.Provider>;
}

export const useDetail = () => useContext(Ctx);
