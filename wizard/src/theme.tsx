import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = { dark: boolean; toggle: () => void };

const ThemeContext = createContext<Theme>({ dark: false, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

function initialDark(): boolean {
  try {
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(initialDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);

  return <ThemeContext.Provider value={{ dark, toggle: () => setDark((v) => !v) }}>{children}</ThemeContext.Provider>;
}
