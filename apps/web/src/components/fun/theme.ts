/** Dusk (light) and night (dark) themes. The choice is remembered in this
 *  browser; with no choice saved, the system setting decides. */
import { useCallback, useEffect, useState } from "react";

export type ThemeName = "dusk" | "night";
const KEY = "fp-theme";

function stored(): ThemeName | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "dusk" || value === "night" ? value : null;
  } catch {
    return null;
  }
}

function system(): ThemeName {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "dusk";
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#1a0d17" : "#5b2a4e");
}

/** Call once at startup so the first paint is already in the right theme. */
export function initTheme(): void {
  applyTheme(stored() ?? system());
}

export function useTheme(): { theme: ThemeName; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeName>(() => (document.documentElement.dataset.theme as ThemeName) || "dusk");

  useEffect(() => {
    if (stored()) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      const next = system();
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: ThemeName = current === "night" ? "dusk" : "night";
      // A soft cross-fade instead of a hard flash.
      document.documentElement.classList.add("fp-theme-fade");
      window.setTimeout(() => document.documentElement.classList.remove("fp-theme-fade"), 450);
      applyTheme(next);
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        /* not kept in private mode */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
