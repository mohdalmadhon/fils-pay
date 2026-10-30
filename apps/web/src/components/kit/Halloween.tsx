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
 *   - a ghost that haunts the page on its own: it drifts from place to
 *     place, fades away and reappears somewhere else. It never follows the
 *     pointer; touch it and it says boo and vanishes
 *
 * Bats and the ghost never take clicks (pointer-events: none), so the page
 * underneath always works; only the small spider can be grabbed.
 *
 * Everything is vector SVG (halloweenArt.tsx). The choice is kept in this
 * browser. Under prefers-reduced-motion everything is still: the
 * decorations stay, nothing flies or follows. All decorations are
 * aria-hidden; the button itself is a normal toggle (aria-pressed).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion.js";
import { PixelArt } from "./pixelArt.js";
import { Bat, Cobweb, Ghost, Moon, Pumpkin, Spider } from "./halloweenArt.js";

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
        {/* A jack-o'-lantern: dark until the costume lights it. */}
        <Pumpkin lit={on} className="fp-hw-pumpkin" />
        <span className="fp-hw-tip" aria-hidden>
          {on ? "Take off the costume" : "Halloween costume"}
        </span>
      </button>
      {on ? <HalloweenSky /> : null}
      {on ? <HalloweenLayer /> : null}
    </>
  );
}

/* The sky behind the page ------------------------------------------------ */

/** Star positions from a fixed seed, so they don't jump on every render. */
const STARS = (() => {
  let seed = 31;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 46 }, () => ({
    left: `${(rnd() * 100).toFixed(2)}%`,
    top: `${(rnd() * 70).toFixed(2)}%`,
    delay: `${(rnd() * 4).toFixed(2)}s`,
    big: rnd() < 0.2,
  }));
})();

/** Graveyard props along the bottom: [sprite, left %]. */
const GRAVES: ReadonlyArray<readonly ["tombRound" | "tombCross" | "pumpkinLit", number]> = [
  ["tombCross", 4],
  ["tombRound", 11],
  ["pumpkinLit", 17],
  ["tombRound", 29],
  ["tombCross", 46],
  ["tombRound", 58],
  ["pumpkinLit", 66],
  ["tombCross", 74],
  ["tombRound", 86],
];

/**
 * Scenery behind the page content (z-index -1, so it never covers text or
 * takes a click): twinkling pixel stars, a witch who crosses the sky now
 * and then, a graveyard with tombstones and jack-o'-lanterns along the
 * bottom, and drifting pixel fog.
 */
function HalloweenSky() {
  return (
    <div className="fp-hw-sky" aria-hidden>
      {STARS.map((star, i) => (
        <span
          key={i}
          className={`fp-hw-star${star.big ? " is-big" : ""}`}
          style={{ left: star.left, top: star.top, animationDelay: star.delay }}
        />
      ))}
      <div className="fp-hw-witch">
        <PixelArt sprite="witch" />
      </div>
      <div className="fp-hw-graveyard">
        {GRAVES.map(([sprite, left]) => (
          <span key={`${sprite}-${left}`} className="fp-hw-grave-slot" style={{ left: `${left}%` }}>
            <PixelArt sprite={sprite} className={`fp-hw-grave fp-hw-grave-${sprite}`} />
          </span>
        ))}
        <div className="fp-hw-ground" />
      </div>
      <div className="fp-hw-fog fp-hw-fog-back" />
      <div className="fp-hw-fog fp-hw-fog-front" />
    </div>
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
    // The ghost drifts toward (tx, ty); when it gets there, or every so
    // often, it fades out (hiddenUntil) and reappears somewhere else.
    ghost: { x: 0, y: 0, tx: 0, ty: 0, nextVanish: 0, hiddenUntil: 0 },
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
    s.ghost = { x: w() * 0.3, y: h() * 0.55, tx: w() * 0.3, ty: h() * 0.55, nextVanish: 0, hiddenUntil: 0 };
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
      s.ghost = { ...s.ghost, x: w() - 120, y: h() - 150 };
      render(0);
      return;
    }

    const vanish = (now: number, forMs: number) => {
      // The fade takes 600ms (CSS), then it is gone until hiddenUntil.
      s.ghost.hiddenUntil = now + 600 + forMs;
      ghostEl.current?.classList.add("is-gone");
    };

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

      // The ghost haunts on its own and pays the pointer no attention.
      const g = s.ghost;
      if (g.nextVanish === 0) g.nextVanish = now + 9000 + Math.random() * 7000;
      if (g.hiddenUntil > 0) {
        if (now >= g.hiddenUntil) {
          // Reappear somewhere new, with a new place to drift to.
          g.hiddenUntil = 0;
          g.x = 40 + Math.random() * (W - 130);
          g.y = H * 0.2 + Math.random() * (H * 0.6);
          pickGhostTarget(g, W, H);
          g.nextVanish = now + 9000 + Math.random() * 7000;
          ghostEl.current?.classList.remove("is-gone");
        }
      } else {
        const dx = g.tx - g.x;
        const dy = g.ty - g.y;
        const d = Math.hypot(dx, dy);
        if (d < 6) pickGhostTarget(g, W, H);
        else {
          const speed = 38; // px per second: a slow, aimless float
          g.x += (dx / d) * speed * dt;
          g.y += (dy / d) * speed * dt;
        }
        if (now >= g.nextVanish) vanish(now, 900 + Math.random() * 2200);
        // Touch it and it says boo, then vanishes.
        else if (Math.hypot(s.px - (g.x + 24), s.py - (g.y + 27)) < 30 && now - s.lastBoo > 1400) {
          s.lastBoo = now;
          booRef.current();
          g.nextVanish = now + 900; // say it first, then fade away
        }
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
      <Moon className="fp-hw-moon" />
      <Cobweb className="fp-hw-web fp-hw-web-left" />
      <Cobweb className="fp-hw-web fp-hw-web-right" />

      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          ref={(node) => {
            batEls.current[i] = node;
          }}
          className="fp-hw-bat"
        >
          <Bat />
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
          <Spider />
        </div>
      </div>

      <div
        ref={ghostEl}
        className={`fp-hw-ghost${boo ? " is-boo" : ""}`}
      >
        <Ghost frame="a" className="fp-hw-frame fp-hw-frame-a" />
        <Ghost frame="b" className="fp-hw-frame fp-hw-frame-b" />
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

/** Somewhere new for the ghost to drift to, away from the very edges. */
function pickGhostTarget(g: { tx: number; ty: number }, W: number, H: number): void {
  g.tx = 30 + Math.random() * Math.max(60, W - 110);
  g.ty = H * 0.15 + Math.random() * (H * 0.65);
}
