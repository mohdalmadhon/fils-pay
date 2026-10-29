/**
 * Ctrl+K / Cmd+K command palette: type to jump to any page or run an action
 * (switch theme, create a payment link, log out). Arrow keys move, Enter
 * runs, Escape closes. Matching is forgiving: the letters you type only have
 * to appear in order ("pl" finds "Payment links").
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface Command {
  id: string;
  label: string;
  group: "Go to" | "Actions";
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
}

/** Scores a subsequence match; null when the letters don't appear in order. */
function score(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let total = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 0;
    total += 1 + streak * 2 + (found === 0 || t[found - 1] === " " ? 3 : 0);
    ti = found + 1;
  }
  return total - t.length * 0.02;
}

export function useCommandPaletteShortcut(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const results = useMemo(() => {
    return commands
      .map((c) => ({ c, s: score(query, `${c.label} ${c.keywords ?? ""}`) }))
      .filter((r): r is { c: Command; s: number } => r.s !== null)
      .sort((a, b) => (query ? b.s - a.s : 0))
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    setQuery("");
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  let lastGroup = "";
  return (
    <div className="fp-palette-scrim" onMouseDown={onClose}>
      <div
        className="fp-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(results[active]);
          } else if (e.key === "Tab") {
            e.preventDefault();
          }
        }}
      >
        <div className="fp-palette-search">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page or run an action"
            aria-label="Search commands"
            aria-controls="fp-palette-list"
            aria-activedescendant={results[active] ? `fp-cmd-${results[active]!.id}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="fp-palette-list" className="fp-palette-list" role="listbox">
          {results.length === 0 ? <li className="fp-palette-empty">Nothing matches &ldquo;{query}&rdquo;.</li> : null}
          {results.map((command, index) => {
            const heading = command.group !== lastGroup && !query ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id} role="presentation">
                {heading ? <span className="fp-palette-group">{heading}</span> : null}
                <div
                  id={`fp-cmd-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  className="fp-palette-item"
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span className="fp-palette-icon">{command.icon}</span>
                  {command.label}
                  {index === active ? <kbd>Enter</kbd> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
