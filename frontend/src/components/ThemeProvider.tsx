"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "dark", setTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("ed4ns-theme") as Theme | null;
    const initial = saved || "dark";
    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("ed4ns-theme", t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
      <ThemeToggle theme={theme} setTheme={setTheme} />
    </ThemeContext.Provider>
  );
}

function ThemeToggle({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  return (
    <div className="theme-toggle">
      <button
        className={`theme-btn ${theme === "light" ? "active" : ""}`}
        onClick={() => setTheme("light")}
      >
        Light
      </button>
      <button
        className={`theme-btn ${theme === "dark" ? "active" : ""}`}
        onClick={() => setTheme("dark")}
      >
        Dark
      </button>
    </div>
  );
}
