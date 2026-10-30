/**
 * The Halloween costume.
 *
 * A pumpkin button (bottom right, on every page) dresses the whole site for
 * Halloween: night falls in peach and rose (tokens in theme.css), and an
 * interactive layer appears over the page:
 *
 *   - a lantern glow that follows the pointer
 *   - cobwebs in the corners and a full moon
 *   - bats that wander the sky and flee from the pointer; catch one (touch
 *     it with the pointer) and it vanishes in a puff, with a running count
 *   - a spider on a thread that can be pulled down and springs back
 *   - a small ghost that trails the pointer and says boo if you catch it
 *
 * Bats and the ghost never take clicks (pointer-events: none), so the page
 * underneath always works; only the small spider can be grabbed.
 *
 * Everything is pixel art (pixelArt.tsx). The choice is kept in this
 * browser. Under prefers-reduced-motion everything is still: the
 * decorations stay, nothing flies or follows. All decorations are
 * aria-hidden; the button itself is a normal toggle (aria-pressed).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion.js";
import { PixelArt } from "./pixelArt.js";

const KEY = "fp-costume";
const CHANGE = "fp-costume-change";

function readCostume(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "halloween";
  } catch {
    return false;
  }
}

function applyCostume(on: boolean): void {
  if (on) document.documentElement.dataset.costume = "halloween";
  else delete document.documentElement.dataset.costume;
}

/** Call once at startup so the first paint is already in costume. */
export function initCostume(): void {
  applyCostume(readCostume());
}

export function useCostume(): { on: boolean; toggle: (origin?: { x: number; y: number }) => void } {
  const [on, setOn] = useState(() => document.documentElement.dataset.costume === "halloween");

  const toggle = useCallback((origin?: { x: number; y: number }) => {
    const next = document.documentElement.dataset.costume !== "halloween";
    const commit = () => {
      applyCostume(next);
      setOn(next);
      try {
        window.localStorage.setItem(KEY, next ? "halloween" : "off");
      } catch {
        /* not kept in private mode */
      }
      window.dispatchEvent(new Event(CHANGE));
    };
    // A circle of night (or day) spreads out from the pumpkin.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) {
      if (origin) {
        document.documentElement.style.setProperty("--hw-ox", `${origin.x}px`);
        document.documentElement.style.setProperty("--hw-oy", `${origin.y}px`);
      }
      doc.startViewTransition(commit);
    } else {
      commit();
    }
  }, []);

  // Stay in step with other toggles on this page (the pumpkin, the command
  // palette) and with other tabs.
  useEffect(() => {
    const sync = () => setOn(document.documentElement.dataset.costume === "halloween");
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      applyCostume(e.newValue === "halloween");
      sync();
    };
    window.addEventListener(CHANGE, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { on, toggle };
}

/* The pumpkin button ------------------------------------------------------ */

export function HalloweenToggle() {
  const { on, toggle } = useCostume();
  const button = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="fp-hw-toggle"
        aria-pressed={on}
        aria-label="Halloween costume"
        onClick={() => {
          const box = button.current?.getBoundingClientRect();
          toggle(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
        }}
      >
        {/* A pixel jack-o'-lantern: dark until the costume lights it. */}
        <PixelArt sprite={on ? "pumpkinLit" : "pumpkinDark"} className="fp-hw-pumpkin" />
        <span className="fp-hw-tip" aria-hidden>
          {on ? "Take off the costume" : "Halloween costume"}
        </span>
      </button>
      {on ? <HalloweenLayer /> : null}
    </>
  );
}

/* The night layer --------------------------------------------------------- */

interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  gone: boolean;
}

const GHOST_LINES = ["Boo!", "Boo! Did I scare you?", "This ledger is haunted.", "I'm the ghost of a refunded fils.", "Spooky settlement!"];

function HalloweenLayer() {
  const layer = useRef<HTMLDivElement>(null);
  const batEls = useRef<Array<HTMLDivElement | null>>([]);
  const ghostEl = useRef<HTMLDivElement>(null);
  const spiderEl = useRef<HTMLDivElement>(null);
  const threadEl = useRef<HTMLDivElement>(null);
  const [shooed, setShooed] = useState(0);
  const [boo, setBoo] = useState<{ id: number; text: string } | null>(null);

  const state = useRef({
    px: -1000,
    py: -1000,
    lastMove: 0,
    lastBoo: 0,
    bats: [] as Bat[],
    ghost: { x: 0, y: 0 },
    spider: { len: 120, v: 0, rest: 120, dragging: false },
  });

  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const w = () => window.innerWidth;
    const h = () => window.innerHeight;
    const s = state.current;
    s.bats = Array.from({ length: 4 }, (_, i) => ({
      x: (w() / 4) * i + Math.random() * 80,
      y: 60 + Math.random() * h() * 0.3,
      vx: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60),
      vy: 0,
      phase: Math.random() * Math.PI * 2,
      gone: false,
    }));
    s.ghost = { x: 80, y: h() - 140 };
    s.spider.rest = Math.min(160, h() * 0.18);
    s.spider.len = s.spider.rest;

    const render = (t: number) => {
      s.bats.forEach((b, i) => {
        const node = batEls.current[i];
        if (!node) return;
        const flip = b.vx < 0 ? -1 : 1;
        node.style.transform = `translate(${b.x.toFixed(1)}px, ${(b.y + Math.sin(t / 300 + b.phase) * 6).toFixed(1)}px) scaleX(${flip})`;
      });
      if (ghostEl.current) {
        const bob = Math.sin(t / 500) * 4;
        ghostEl.current.style.transform = `translate(${s.ghost.x.toFixed(1)}px, ${(s.ghost.y + bob).toFixed(1)}px)`;
      }
      if (spiderEl.current && threadEl.current) {
        threadEl.current.style.height = `${s.spider.len.toFixed(1)}px`;
        spiderEl.current.style.transform = `translateY(${(s.spider.len - 3).toFixed(1)}px)`;
      }
    };

    if (prefersReducedMotion()) {
      // Still life: bats rest near the moon, the ghost by the pumpkin.
      s.bats.forEach((b, i) => {
        b.x = w() * 0.62 + i * 52;
        b.y = 70 + (i % 2) * 26;
      });
      s.ghost = { x: w() - 120, y: h() - 130 };
      render(0);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const W = w();
      const H = h();

      // Bats wander, and scatter when the pointer comes close.
      for (const b of s.bats) {
        if (b.gone) continue;
        b.phase += dt;
        const dx = b.x + 30 - s.px; // the bat sprite's middle (60x30)
        const dy = b.y + 15 - s.py;
        const d = Math.hypot(dx, dy);
        if (d < 28) {
          poofRef.current(s.bats.indexOf(b));
          continue;
        }
        if (d < 120) {
          const f = (120 - d) / 120;
          b.vx += (dx / Math.max(d, 1)) * 1500 * f * dt;
          b.vy += (dy / Math.max(d, 1)) * 1500 * f * dt;
        }
        b.vy += Math.sin(now / 700 + b.phase * 3) * 30 * dt;
        b.vy += (Math.min(H * 0.32, 220) - b.y) * 0.6 * dt; // drift back to the sky band
        const speed = Math.hypot(b.vx, b.vy);
        const max = 520;
        if (speed > max) {
          b.vx = (b.vx / speed) * max;
          b.vy = (b.vy / speed) * max;
        }
        // Ease back to a lazy cruise.
        const cruise = 90;
        if (Math.abs(b.vx) < cruise) b.vx += Math.sign(b.vx || 1) * 40 * dt;
        b.vx *= 0.995;
        b.vy *= 0.98;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x > W + 60) b.x = -60;
        if (b.x < -60) b.x = W + 60;
        b.y = Math.max(20, Math.min(H * 0.55, b.y));
      }

      // The ghost trails the pointer, keeping a polite distance.
      const idle = now - s.lastMove > 2500 || s.px < 0;
      const tx = idle ? W - 116 : s.px - 70;
      const ty = idle ? H - 132 : s.py - 72;
      s.ghost.x += (Math.max(8, Math.min(W - 52, tx)) - s.ghost.x) * Math.min(1, dt * 3);
      s.ghost.y += (Math.max(8, Math.min(H - 60, ty)) - s.ghost.y) * Math.min(1, dt * 3);
      // Catch the ghost and it says boo, then darts off.
      if (Math.hypot(s.px - (s.ghost.x + 22), s.py - (s.ghost.y + 26)) < 30 && now - s.lastBoo > 1400) {
        s.lastBoo = now;
        booRef.current();
        s.ghost.x += s.px > s.ghost.x + 22 ? -90 : 90;
        s.ghost.y -= 40;
      }

      // The spider: a spring on a thread, unless someone is pulling it.
      const sp = s.spider;
      if (!sp.dragging) {
        const rest = sp.rest + Math.sin(now / 1400) * 6;
        sp.v += (rest - sp.len) * 40 * dt;
        sp.v *= Math.pow(0.18, dt);
        sp.len += sp.v * dt;
      }

      // The lantern follows the pointer.
      if (s.px >= 0) {
        el.style.setProperty("--hx", `${s.px}px`);
        el.style.setProperty("--hy", `${s.py}px`);
      }

      render(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = (e: PointerEvent) => {
      s.px = e.clientX;
      s.py = e.clientY;
      s.lastMove = performance.now();
      if (s.spider.dragging) {
        const top = spiderEl.current?.parentElement?.getBoundingClientRect().top ?? 0;
        s.spider.len = Math.max(30, Math.min(window.innerHeight * 0.8, e.clientY - top - 10));
        s.spider.v = 0;
      }
    };
    const onUp = () => {
      s.spider.dragging = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const poof = (i: number) => {
    if (i < 0) return;
    const b = state.current.bats[i];
    const node = batEls.current[i];
    if (!b || !node || b.gone) return;
    b.gone = true;
    node.classList.add("is-poof");
    setShooed((n) => n + 1);
    window.setTimeout(() => {
      b.gone = false;
      b.x = b.vx > 0 ? -60 : window.innerWidth + 60;
      b.y = 60 + Math.random() * window.innerHeight * 0.25;
      node.classList.remove("is-poof");
    }, 2600);
  };

  const sayBoo = () => {
    const text = GHOST_LINES[Math.floor(Math.random() * GHOST_LINES.length)]!;
    setBoo({ id: Date.now(), text });
  };
  const poofRef = useRef(poof);
  poofRef.current = poof;
  const booRef = useRef(sayBoo);
  booRef.current = sayBoo;

  return (
    <div ref={layer} className="fp-hw-layer" aria-hidden>
      <div className="fp-hw-lantern" />
      <div className="fp-hw-vignette" />
      <PixelArt sprite="moon" className="fp-hw-moon" />
      <PixelArt sprite="cobweb" className="fp-hw-web fp-hw-web-left" />
      <PixelArt sprite="cobweb" className="fp-hw-web fp-hw-web-right" />

      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          ref={(node) => {
            batEls.current[i] = node;
          }}
          className="fp-hw-bat"
        >
          <PixelArt sprite="batUp" className="fp-hw-frame fp-hw-frame-a" />
          <PixelArt sprite="batDown" className="fp-hw-frame fp-hw-frame-b" />
        </div>
      ))}

      <div className="fp-hw-spider">
        <div ref={threadEl} className="fp-hw-thread" />
        <div
          ref={spiderEl}
          className="fp-hw-spider-body"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            state.current.spider.dragging = true;
          }}
        >
          <PixelArt sprite="spider" />
        </div>
      </div>

      <div
        ref={ghostEl}
        className={`fp-hw-ghost${boo ? " is-boo" : ""}`}
      >
        <Ghost />
        {boo ? (
          <span key={boo.id} className="fp-hw-ghost-bubble" onAnimationEnd={() => setBoo(null)}>
            {boo.text}
          </span>
        ) : null}
      </div>

      {prefersReducedMotion() ? null : (
        <span key={shooed} className="fp-hw-score">
          {shooed > 0 ? `${shooed} ${shooed === 1 ? "bat" : "bats"} caught` : "Catch a bat, or the ghost"}
        </span>
      )}
    </div>
  );
}

function Ghost() {
  return (
    <svg viewBox="0 0 44 52">
      <defs>
        <linearGradient id="fp-hw-ghost" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6f1" />
          <stop offset="100%" stopColor="#ffcdb2" />
        </linearGradient>
      </defs>
      <path
        d="M22 2C11 2 4 10 4 21v27l6-5 6 5 6-5 6 5 6-5 6 5V21C40 10 33 2 22 2Z"
        fill="url(#fp-hw-ghost)"
        stroke="#e5989b"
        strokeWidth="1"
      />
      <ellipse cx="16" cy="20" rx="2.6" ry="3.6" fill="#2a1418" />
      <ellipse cx="28" cy="20" rx="2.6" ry="3.6" fill="#2a1418" />
      <ellipse cx="22" cy="29" rx="3" ry="2.2" fill="#2a1418" opacity="0.8" />
      <circle cx="12" cy="26" r="2.4" fill="#e5989b" opacity="0.5" />
      <circle cx="32" cy="26" r="2.4" fill="#e5989b" opacity="0.5" />
    </svg>
  );
}
