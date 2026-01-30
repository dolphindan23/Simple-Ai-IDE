import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "terminal-noir" | "alpha-terminal";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "terminal-noir", label: "Terminal Noir" },
  { value: "alpha-terminal", label: "Alpha Terminal" },
];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("simpleaide-theme") as Theme;
      if (stored && THEME_OPTIONS.some(o => o.value === stored)) return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark", "terminal-noir", "alpha-terminal");
    root.classList.add(theme);
    localStorage.setItem("simpleaide-theme", theme);
  }, [theme]);

  const cycleTheme = () => {
    const currentIndex = THEME_OPTIONS.findIndex(o => o.value === theme);
    const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
    setTheme(THEME_OPTIONS[nextIndex].value);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
