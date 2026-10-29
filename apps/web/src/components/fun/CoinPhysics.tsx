/**
 * A pile of glossy coins with real(ish) physics on a canvas: they drop,
 * bounce, spin, stack against each other, and can be flicked with the
 * pointer. Used as the playful layer on sign-in, checkout (a coin drops for
 * every card digit), the paid screen (a coin shower) and the Konami egg.
 *
 * The canvas is decorative (aria-hidden). Under prefers-reduced-motion the
 * coins are settled instantly and drawn once, with no animation loop. The
 * loop also sleeps whenever every coin has come to rest.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { drawCoin, fitCanvas, prefersReducedMotion, type CoinTint } from "./coinDraw.js";

export interface CoinPhysicsHandle {
  /** Drop coins from the top edge (at `x` if given, else at random). */
  drop(count?: number, x?: number): void;
  /** Throw coins up and out from a point (default: centre bottom). */
  burst(count?: number, x?: number, y?: number): void;
  /** Remove every coin. */
  clear(): void;
}

interface Props {
  className?: string;
  /** Coins dropped one after another when the canvas first appears. */
  initial?: number;
  /** Let the pointer flick coins, and a click on empty space add one. */
  interactive?: boolean;
  /** Called with the running total each time a coin is flicked. */
  onFlick?: (total: number) => void;
  maxCoins?: number;
  /** Let coins fall out of the bottom instead of piling up (a shower). */
  noFloor?: boolean;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  turn: number;
  spin: number;
  tint: CoinTint;
  lastFlick: number;
}

const GRAVITY = 1900;
const BOUNCE = 0.32;

export const CoinPhysics = forwardRef<CoinPhysicsHandle, Props>(function CoinPhysics(
  { className, initial = 0, interactive = false, onFlick, maxCoins = 90, noFloor = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coins = useRef<Body[]>([]);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const frame = useRef(0);
  const running = useRef(false);
  const restFrames = useRef(0);
  const flicks = useRef(0);
  const onFlickRef = useRef(onFlick);
  onFlickRef.current = onFlick;
  const reduced = useRef(false);

  function radius(): number {
    const base = Math.min(24, Math.max(11, size.current.w / 34));
    return base * (0.85 + Math.random() * 0.3);
  }

  function add(body: Omit<Body, "r" | "turn" | "spin" | "tint" | "lastFlick"> & Partial<Body>): void {
    const list = coins.current;
    list.push({
      r: radius(),
      turn: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 22,
      tint: Math.random() < 0.18 ? "rose" : "gold",
      lastFlick: 0,
      ...body,
    });
    if (list.length > maxCoins) list.splice(0, list.length - maxCoins);
  }

  function step(dt: number): boolean {
    const { w, h } = size.current;
    const list = coins.current;
    let moving = false;
    for (const c of list) {
      c.vy += GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.turn += c.spin * dt;

      const grounded = !noFloor && c.y + c.r >= h - 0.5;
      if (!noFloor && c.y + c.r > h) {
        c.y = h - c.r;
        c.vy = Math.abs(c.vy) < 60 ? 0 : -c.vy * BOUNCE;
        c.vx *= 0.9;
      }
      if (c.x - c.r < 0) {
        c.x = c.r;
        c.vx = Math.abs(c.vx) * 0.5;
      } else if (c.x + c.r > w) {
        c.x = w - c.r;
        c.vx = -Math.abs(c.vx) * 0.5;
      }
      // Spin settles so resting coins face the viewer.
      c.spin *= 0.995;
      if (grounded || Math.hypot(c.vx, c.vy) < 220) {
        c.spin *= 0.9;
        if (Math.abs(c.spin) < 0.6) {
          const target = Math.round(c.turn / Math.PI) * Math.PI;
          c.turn += (target - c.turn) * 0.12;
        }
      }
      if (Math.abs(c.vx) > 4 || Math.abs(c.vy) > 4 || Math.abs(c.spin) > 0.3) moving = true;
    }

    // Coin-on-coin contacts: separate overlaps and exchange momentum.
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.r + b.r) * 0.92;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const k = (-(1 + 0.2) * rel) / 2;
          a.vx -= k * nx;
          a.vy -= k * ny;
          b.vx += k * nx;
          b.vy += k * ny;
          a.vx *= 0.985;
          b.vx *= 0.985;
        }
      }
    }

    if (noFloor) {
      coins.current = list.filter((c) => c.y - c.r < h + 40);
      if (coins.current.length) moving = true;
    }
    return moving;
  }

  function draw(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const c of coins.current) {
      // A soft contact shadow under coins near the floor.
      if (!noFloor && c.y + c.r > h - 6) {
        ctx.beginPath();
        ctx.ellipse(c.x + 2, h - 1, c.r * 0.9, 3, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(43, 20, 38, 0.18)";
        ctx.fill();
      }
      drawCoin(ctx, c.x, c.y, c.r, c.turn, c.tint);
    }
  }

  function loop(): void {
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const first = step(dt / 2);
      const moving = step(dt / 2) || first;
      draw();
      restFrames.current = moving ? 0 : restFrames.current + 1;
      if (restFrames.current > 45 || document.hidden) {
        running.current = false;
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function wake(): void {
    restFrames.current = 0;
    if (reduced.current) {
      // No motion: settle the pile off-screen and draw the result once.
      for (let i = 0; i < 400; i++) step(1 / 60);
      draw();
      return;
    }
    if (running.current) return;
    running.current = true;
    loop();
  }

  useImperativeHandle(ref, () => ({
    drop(count = 1, x) {
      const { w } = size.current;
      for (let i = 0; i < count; i++) {
        const r = radius();
        add({
          x: x ?? r + Math.random() * (w - r * 2),
          y: -r - i * r * 2.2,
          vx: (Math.random() - 0.5) * 120,
          vy: 80 + Math.random() * 60,
        });
      }
      wake();
    },
    burst(count = 30, x, y) {
      const { w, h } = size.current;
      const ox = x ?? w / 2;
      const oy = y ?? h;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const speed = 900 + Math.random() * 900;
        add({ x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, spin: (Math.random() - 0.5) * 40 });
      }
      wake();
    },
    clear() {
      coins.current = [];
      draw();
    },
  }));

  // Size, initial drop, and teardown.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    reduced.current = prefersReducedMotion();
    size.current = fitCanvas(canvas);
    const observer = new ResizeObserver(() => {
      size.current = fitCanvas(canvas);
      wake();
      draw();
    });
    observer.observe(canvas);

    const timers: number[] = [];
    if (initial > 0) {
      if (reduced.current) {
        for (let i = 0; i < initial; i++) {
          const r = radius();
          add({ x: r + Math.random() * (size.current.w - r * 2), y: -r - i * r * 2, vx: 0, vy: 0 });
        }
        wake();
      } else {
        for (let i = 0; i < initial; i++) {
          timers.push(
            window.setTimeout(() => {
              const r = radius();
              add({ x: r + Math.random() * (size.current.w - r * 2), y: -r, vx: (Math.random() - 0.5) * 160, vy: 0 });
              wake();
            }, 250 + i * 70),
          );
        }
      }
    }
    const onVisible = () => {
      if (!document.hidden) wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(frame.current);
      running.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pointer: flick coins the pointer sweeps through; click empty space to add one.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!interactive || !canvas || !host) return;
    let lx = 0;
    let ly = 0;
    let lt = 0;
    const local = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const now = performance.now();
      const dt = Math.max(8, now - lt) / 1000;
      const pvx = Math.max(-3000, Math.min(3000, (p.x - lx) / dt));
      const pvy = Math.max(-3000, Math.min(3000, (p.y - ly) / dt));
      const fresh = now - lt < 120;
      lx = p.x;
      ly = p.y;
      lt = now;
      if (!fresh || reduced.current) return;
      const speed = Math.hypot(pvx, pvy);
      let touched = false;
      for (const c of coins.current) {
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const reach = c.r + 22;
        if (dx * dx + dy * dy > reach * reach) continue;
        const d = Math.max(1, Math.hypot(dx, dy));
        c.vx += pvx * 0.55 + (dx / d) * 160;
        c.vy += pvy * 0.55 + (dy / d) * 160 - 120;
        c.spin += pvx * 0.02;
        touched = true;
        if (speed > 350 && now - c.lastFlick > 500) {
          c.lastFlick = now;
          flicks.current += 1;
          onFlickRef.current?.(flicks.current);
        }
      }
      if (touched) wake();
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest("a, button, input, label, select, textarea, summary")) return;
      const p = local(e);
      const box = canvas.getBoundingClientRect();
      if (p.x < 0 || p.y < 0 || p.x > box.width || p.y > box.height) return;
      const hit = coins.current.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r);
      if (hit) {
        for (const c of coins.current) {
          if (Math.hypot(c.x - p.x, c.y - p.y) < c.r * 3) {
            c.vy -= 700 + Math.random() * 300;
            c.vx += (c.x - p.x) * 8;
            c.spin += (Math.random() - 0.5) * 50;
          }
        }
      } else {
        add({ x: p.x, y: p.y, vx: 0, vy: 0 });
      }
      wake();
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerdown", onDown);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  return <canvas ref={canvasRef} className={["fp-coins", className].filter(Boolean).join(" ")} aria-hidden />;
});
