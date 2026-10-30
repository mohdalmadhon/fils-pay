/**
 * Appearance: which design (Carnival, Blush, Slate), light or dark mode,
 * sidebar or top-bar layout, and comfortable or compact spacing. Chosen in
 * Settings, remembered in this browser, and applied to <html> as data
 * attributes before the first paint:
 *
 *   data-design="carnival|blush|slate"   colours, type and shapes
 *   data-theme="night"                   present in dark mode
 *   data-layout="topbar"                 present for the top-bar layout
 *   data-density="compact"               present for compact spacing
 *
 * Mode "system" follows the operating system's light or dark setting.
 * Older saves (the plain "fp-theme" light/night key) are read once and
 * carried over.
 */
import { useCallback, useEffect, useState } from "react";

export type Design = "carnival" | "blush" | "slate";
export type Mode = "light" | "dark" | "system";
export type Layout = "sidebar" | "topbar";
export type Density = "comfortable" | "compact";

export interface Appearance {
  design: Design;
  mode: Mode;
  layout: Layout;
  density: Density;
}

export const DESIGNS: ReadonlyArray<{ id: Design; name: string; description: string }> = [
  { id: "carnival", name: "Carnival", description: "Indigo with sun, rose and mint, and bold shapes." },
  { id: "blush", name: "Blush", description: "Soft pink and sand, with black pill buttons." },
  { id: "slate", name: "Slate", description: "Calm slate blue with coral actions." },
];

export const DEFAULT_APPEARANCE: Appearance = { design: "carnival", mode: "system", layout: "sidebar", density: "comfortable" };

const KEY = "fp-appearance";
const LEGACY_KEY = "fp-theme";
const CHANGE = "fp-appearance-change";

const isDesign = (v: unknown): v is Design => v === "carnival" || v === "blush" || v === "slate";
const isMode = (v: unknown): v is Mode => v === "light" || v === "dark" || v === "system";

/** The saved appearance, with anything missing or unknown set to its default. */
export function readAppearance(): Appearance {
  const out = { ...DEFAULT_APPEARANCE };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Appearance>;
      if (isDesign(saved.design)) out.design = saved.design;
      if (isMode(saved.mode)) out.mode = saved.mode;
      if (saved.layout === "topbar") out.layout = "topbar";
      if (saved.density === "compact") out.density = "compact";
    } else {
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy === "night") out.mode = "dark";
      else if (legacy === "light" || legacy === "dusk") out.mode = "light";
    }
  } catch {
    /* storage blocked or bad JSON: defaults */
  }
  return out;
}

function systemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedDark(a: Appearance): boolean {
  return a.mode === "dark" || (a.mode === "system" && systemDark());
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.dataset.design = a.design;
  if (resolvedDark(a)) root.dataset.theme = "night";
  else delete root.dataset.theme;
  if (a.layout === "topbar") root.dataset.layout = "topbar";
  else delete root.dataset.layout;
  if (a.density === "compact") root.dataset.density = "compact";
  else delete root.dataset.density;
  // The browser chrome (mobile address bar) matches the page.
  const bg = getComputedStyle(root).getPropertyValue("--c-bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

/** Call once at startup so the first paint already has the right look. */
export function initTheme(): void {
  applyAppearance(readAppearance());
}

/** Read and change the appearance; every component using it stays in step. */
export function useAppearance(): {
  appearance: Appearance;
  dark: boolean;
  update: (change: Partial<Appearance>) => void;
} {
  const [appearance, setState] = useState<Appearance>(readAppearance);
  const [dark, setDark] = useState(() => resolvedDark(readAppearance()));

  useEffect(() => {
    const sync = () => {
      const a = readAppearance();
      setState(a);
      setDark(resolvedDark(a));
    };
    window.addEventListener(CHANGE, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      applyAppearance(readAppearance());
      sync();
    };
    window.addEventListener("storage", onStorage);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const follow = () => {
      const a = readAppearance();
      if (a.mode !== "system") return;
      applyAppearance(a);
      sync();
    };
    media?.addEventListener("change", follow);
    return () => {
      window.removeEventListener(CHANGE, sync);
      window.removeEventListener("storage", onStorage);
      media?.removeEventListener("change", follow);
    };
  }, []);

  const update = useCallback((change: Partial<Appearance>) => {
    const next = { ...readAppearance(), ...change };
    // A soft cross-fade instead of a hard flash.
    document.documentElement.classList.add("fp-theme-fade");
    window.setTimeout(() => document.documentElement.classList.remove("fp-theme-fade"), 350);
    applyAppearance(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* not kept in private mode */
    }
    window.dispatchEvent(new Event(CHANGE));
  }, []);

  return { appearance, dark, update };
}

export type ThemeName = "light" | "night";

/** Light or dark only, for the quick switches (sidebar, command palette). */
export function useTheme(): { theme: ThemeName; setTheme: (theme: ThemeName) => void; toggle: () => void } {
  const { dark, update } = useAppearance();
  const theme: ThemeName = dark ? "night" : "light";
  const setTheme = useCallback((t: ThemeName) => update({ mode: t === "night" ? "dark" : "light" }), [update]);
  const toggle = useCallback(() => update({ mode: dark ? "light" : "dark" }), [update, dark]);
  return { theme, setTheme, toggle };
}
