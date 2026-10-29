/** Light and night (dark) themes. The choice is remembered in this browser;
 *  with no choice saved, the system setting decides. */
import { useCallback, useEffect, useState } from "react";

export type ThemeName = "light" | "night";
const KEY = "fp-theme";
const CHANGE = "fp-theme-change";

function stored(): ThemeName | null {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === "night") return "night";
    if (value === "light" || value === "dusk") return "light";
    return null;
  } catch {
    return null;
  }
}

function system(): ThemeName {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "light";
}

export function applyTheme(theme: ThemeName): void {
  if (theme === "night") document.documentElement.dataset.theme = "night";
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#111113" : "#f6f5f2");
}

/** Call once at startup so the first paint is already in the right theme. */
export function initTheme(): void {
  applyTheme(stored() ?? system());
}

function current(): ThemeName {
  return document.documentElement.dataset.theme === "night" ? "night" : "light";
}

export function useTheme(): { theme: ThemeName; setTheme: (theme: ThemeName) => void; toggle: () => void } {
  const [theme, setState] = useState<ThemeName>(current);

  useEffect(() => {
    const sync = () => setState(current());
    window.addEventListener(CHANGE, sync);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (stored()) return;
      applyTheme(system());
      sync();
    };
    media.addEventListener("change", follow);
    return () => {
      window.removeEventListener(CHANGE, sync);
      media.removeEventListener("change", follow);
    };
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    // A soft cross-fade instead of a hard flash.
    document.documentElement.classList.add("fp-theme-fade");
    window.setTimeout(() => document.documentElement.classList.remove("fp-theme-fade"), 350);
    applyTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* not kept in private mode */
    }
    window.dispatchEvent(new Event(CHANGE));
  }, []);

  const toggle = useCallback(() => setTheme(current() === "night" ? "light" : "night"), [setTheme]);

  return { theme, setTheme, toggle };
}
