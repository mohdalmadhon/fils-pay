/**
 * "Catch the fils": a 20-second mini-game for the 404 page. Coins fall, the
 * player steers a purse with the pointer, a finger or the arrow keys.
 * Gold coins are 10 fils, rose coins 50, big sand coins 100, and red
 * chargebacks cost 50. The best score is kept in this browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBhd, toFils } from "@filspay/money";
import { drawCoin, fitCanvas } from "./coinDraw.js";

type Kind = "gold" | "rose" | "big" | "chargeback";
interface Drop {
  x: number;
  y: number;
  vy: number;
  r: number;
  turn: number;
  spin: number;
  kind: Kind;
}
interface Pop {
  x: number;
  y: number;
  text: string;
  life: number;
  bad: boolean;
}

const VALUE: Record<Kind, number> = { gold: 10, rose: 50, big: 100, chargeback: -50 };
const ROUND_SECONDS = 20;
const BEST_KEY = "fp-catch-best";

function readBest(): number {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(value: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* private mode: the best score just isn't kept */
  }
}

const bhd = (fils: number) => `${formatBhd(toFils(Math.max(0, fils)))} BHD`;

export function CatchTheFils({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "done">("ready");
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);

  const game = useRef({
    purseX: 0.5,
    keys: 0,
    drops: [] as Drop[],
    pops: [] as Pop[],
    score: 0,
    started: 0,
    lastSpawn: 0,
    raf: 0,
  });

  useEffect(() => setBest(readBest()), []);

  const draw = useCallback((now: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = fitCanvas(canvas);
    const g = game.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    for (const d of g.drops) {
      if (d.kind === "chargeback") {
        const grad = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 1, d.x, d.y, d.r);
        grad.addColorStop(0, "#ffb3bb");
        grad.addColorStop(1, "#8e2638");
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        const k = d.r * 0.38;
        ctx.beginPath();
        ctx.moveTo(d.x - k, d.y - k);
        ctx.lineTo(d.x + k, d.y + k);
        ctx.moveTo(d.x + k, d.y - k);
        ctx.lineTo(d.x - k, d.y + k);
        ctx.stroke();
      } else {
        drawCoin(ctx, d.x, d.y, d.r, d.turn, d.kind === "rose" ? "rose" : "gold");
      }
    }

    // The purse: a plum pouch with a gold drawstring.
    const pw = Math.min(96, Math.max(64, w * 0.14));
    const px = g.purseX * w;
    const py = h - 18;
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.moveTo(-pw / 2, -pw * 0.42);
    ctx.quadraticCurveTo(-pw * 0.62, pw * 0.1, -pw * 0.36, pw * 0.16);
    ctx.lineTo(pw * 0.36, pw * 0.16);
    ctx.quadraticCurveTo(pw * 0.62, pw * 0.1, pw / 2, -pw * 0.42);
    ctx.closePath();
    const pg = ctx.createLinearGradient(-pw / 2, 0, pw / 2, 0);
    pg.addColorStop(0, "#a5708f");
    pg.addColorStop(0.5, "#5b2a4e");
    pg.addColorStop(1, "#3e1b36");
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -pw * 0.42, pw / 2, pw * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2b1426";
    ctx.fill();
    ctx.strokeStyle = "#e0b15a";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    for (const p of g.pops) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = "700 18px 'Readex Pro', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = p.bad ? "#ff8a96" : "#ffe2a8";
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    void now;
  }, []);

  const finish = useCallback(() => {
    const g = game.current;
    cancelAnimationFrame(g.raf);
    setPhase("done");
    const previous = readBest();
    if (g.score > previous) {
      writeBest(g.score);
      setBest(g.score);
      setNewBest(true);
    }
  }, []);

  const start = useCallback(() => {
    const g = game.current;
    g.drops = [];
    g.pops = [];
    g.score = 0;
    g.purseX = 0.5;
    g.started = performance.now();
    g.lastSpawn = 0;
    setScore(0);
    setTimeLeft(ROUND_SECONDS);
    setNewBest(false);
    setPhase("playing");
    canvasRef.current?.focus();

    let last = performance.now();
    const tick = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = fitCanvas(canvas);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const elapsed = (now - g.started) / 1000;
      const left = Math.max(0, ROUND_SECONDS - elapsed);
      setTimeLeft(Math.ceil(left));
      if (left <= 0) {
        draw(now);
        finish();
        return;
      }

      // Keyboard steering.
      if (g.keys) g.purseX = Math.min(0.97, Math.max(0.03, g.purseX + g.keys * dt * 1.15));

      // Spawning speeds up over the round.
      const every = Math.max(0.22, 0.75 - elapsed * 0.03);
      if (elapsed - g.lastSpawn > every) {
        g.lastSpawn = elapsed;
        const roll = Math.random();
        const kind: Kind = roll < 0.07 ? "big" : roll < 0.25 ? "rose" : roll < 0.42 ? "chargeback" : "gold";
        const r = kind === "big" ? 22 : kind === "chargeback" ? 15 : 14;
        g.drops.push({ x: r + Math.random() * (w - r * 2), y: -r, vy: 140 + elapsed * 14 + Math.random() * 90, r, turn: 0, spin: (Math.random() - 0.5) * 12, kind });
      }

      const pw = Math.min(96, Math.max(64, w * 0.14));
      const px = g.purseX * w;
      const mouthY = h - 18 - pw * 0.42;
      g.drops = g.drops.filter((d) => {
        d.vy += 260 * dt;
        d.y += d.vy * dt;
        d.turn += d.spin * dt;
        if (d.y + d.r * 0.4 >= mouthY && d.y - d.r <= mouthY + 12 && Math.abs(d.x - px) < pw / 2) {
          const value = VALUE[d.kind];
          g.score = Math.max(0, g.score + value);
          setScore(g.score);
          g.pops.push({ x: d.x, y: mouthY - 8, text: value > 0 ? `+${value} fils` : `${value} fils`, life: 1, bad: value < 0 });
          return false;
        }
        return d.y - d.r < h;
      });
      g.pops = g.pops.filter((p) => {
        p.y -= 40 * dt;
        p.life -= dt * 1.4;
        return p.life > 0;
      });

      draw(now);
      g.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
  }, [draw, finish]);

  // Steering by pointer and touch.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      game.current.purseX = Math.min(0.97, Math.max(0.03, (e.clientX - box.left) / box.width));
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onMove);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onMove);
    };
  }, []);

  // Steering by keyboard while a round is on.
  useEffect(() => {
    if (phase !== "playing") return;
    const held = new Set<string>();
    const sync = () => {
      game.current.keys = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    };
    const dir = (key: string) => (key === "ArrowLeft" || key === "a" || key === "A" ? "left" : key === "ArrowRight" || key === "d" || key === "D" ? "right" : null);
    const down = (e: KeyboardEvent) => {
      const d = dir(e.key);
      if (!d) return;
      e.preventDefault();
      held.add(d);
      sync();
    };
    const up = (e: KeyboardEvent) => {
      const d = dir(e.key);
      if (!d) return;
      held.delete(d);
      sync();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      game.current.keys = 0;
    };
  }, [phase]);

  // Show the purse before the first round, and keep it drawn on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(0);
    const observer = new ResizeObserver(() => draw(0));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(game.current.raf), []);

  return (
    <div className={["fp-game", className].filter(Boolean).join(" ")} data-phase={phase}>
      <div className="fp-game-hud" aria-hidden={phase !== "playing"}>
        <span>
          Caught <strong>{bhd(score)}</strong>
        </span>
        <span className="fp-game-time" data-low={timeLeft <= 5}>
          {timeLeft}s
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="fp-game-canvas"
        tabIndex={phase === "playing" ? 0 : -1}
        aria-label="Catch the fils game. Move the purse with the mouse, your finger, or the left and right arrow keys."
      />
      {phase !== "playing" ? (
        <div className="fp-game-overlay">
          {phase === "ready" ? (
            <>
              <p className="fp-game-title">While you&apos;re here: catch the fils</p>
              <p className="fp-game-rules">
                Gold is 10 fils, rose 50, the big ones 100. Dodge the red chargebacks.
              </p>
            </>
          ) : (
            <>
              <p className="fp-game-title" role="status">
                {newBest ? "New best! " : ""}You caught {bhd(score)}
              </p>
              <p className="fp-game-rules">Best in this browser: {bhd(best)}</p>
            </>
          )}
          <button type="button" className="fp-game-play" onClick={start}>
            {phase === "ready" ? "Play (20 seconds)" : "Play again"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
