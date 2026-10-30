import { useRef, useState } from "react";
import type { NavLinkDef } from "./SidebarNav.js";
import type { NavId } from "./navOrder.js";

interface NavOrderEditorProps {
  links: readonly NavLinkDef[];
  onMove: (id: NavId, delta: number) => void;
  onMoveTo: (id: NavId, index: number) => void;
  onReset: () => void;
  onDone: () => void;
  canReset: boolean;
}

/**
 * "Edit layout": the sidebar's links as a list the merchant can rearrange,
 * by dragging a row or with each row's up and down buttons (the keyboard and
 * touch way, and what a screen reader announces). Every change is saved at
 * once; Done just closes the editor.
 */
export function NavOrderEditor({ links, onMove, onMoveTo, onReset, onDone, canReset }: NavOrderEditorProps) {
  const [dragging, setDragging] = useState<NavId | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function announce(id: NavId, index: number): void {
    const label = links.find((l) => l.id === id)?.label ?? id;
    setAnnouncement(`${label} moved to position ${index + 1} of ${links.length}.`);
  }

  function move(id: NavId, delta: number, focusKey: string): void {
    const from = links.findIndex((l) => l.id === id);
    const to = Math.max(0, Math.min(links.length - 1, from + delta));
    if (to === from) return;
    onMove(id, delta);
    announce(id, to);
    // Keep focus on the same button of the row that moved, so pressing it
    // again keeps moving the same link; at an end, use the other button.
    requestAnimationFrame(() => {
      const atEnd = to === 0 || to === links.length - 1;
      const other = focusKey.endsWith(":up") ? `${id}:down` : `${id}:up`;
      (buttons.current.get(atEnd ? other : focusKey) ?? buttons.current.get(focusKey))?.focus();
    });
  }

  return (
    <div className="dash-nav-editor" role="group" aria-labelledby="dash-nav-editor-title">
      <div className="dash-nav-editor-head">
        <span id="dash-nav-editor-title" className="dash-nav-editor-title">
          Edit layout
        </span>
        <span className="dash-nav-editor-hint">Drag a link, or use the arrows.</span>
      </div>
      <ol className="dash-nav-editor-list">
        {links.map((link, index) => (
          <li
            key={link.id}
            className="dash-nav-editor-row"
            draggable
            data-dragging={dragging === link.id || undefined}
            data-over={over === index && dragging !== link.id ? true : undefined}
            onDragStart={(e) => {
              setDragging(link.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", link.id);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(index);
            }}
            onDragLeave={() => setOver((current) => (current === index ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) {
                onMoveTo(dragging, index);
                announce(dragging, index);
              }
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <span className="dash-nav-editor-grip" aria-hidden>
              ⠿
            </span>
            {link.icon}
            <span className="dash-nav-editor-label">{link.label}</span>
            <span className="dash-nav-editor-moves">
              <button
                type="button"
                ref={(el) => void (el ? buttons.current.set(`${link.id}:up`, el) : buttons.current.delete(`${link.id}:up`))}
                aria-label={`Move ${link.label} up`}
                disabled={index === 0}
                onClick={() => move(link.id, -1, `${link.id}:up`)}
              >
                ↑
              </button>
              <button
                type="button"
                ref={(el) => void (el ? buttons.current.set(`${link.id}:down`, el) : buttons.current.delete(`${link.id}:down`))}
                aria-label={`Move ${link.label} down`}
                disabled={index === links.length - 1}
                onClick={() => move(link.id, 1, `${link.id}:down`)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="dash-nav-editor-actions">
        <button type="button" className="dash-nav-editor-reset" onClick={onReset} disabled={!canReset}>
          Reset to default
        </button>
        <button type="button" className="dash-nav-editor-done" onClick={onDone}>
          Done
        </button>
      </div>
      <span className="fp-visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
