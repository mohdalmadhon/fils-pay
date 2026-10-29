/** Drawing a glossy coin on a 2D canvas, shared by the coin physics and the
 *  catch-the-fils game. `turn` is how far the coin has spun (radians): the
 *  face narrows to an edge-on sliver and back, which reads as a flip. */

export type CoinTint = "gold" | "rose";

const TINTS: Record<CoinTint, { hi: string; mid: string; lo: string; edge: string; rim: string }> = {
  gold: { hi: "#fff4d9", mid: "#e0b15a", lo: "#9a6c22", edge: "#8f631d", rim: "rgba(122, 82, 18, 0.45)" },
  rose: { hi: "#ffe8e4", mid: "#e39a8f", lo: "#9c4f55", edge: "#8a434a", rim: "rgba(120, 50, 60, 0.4)" },
};

export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number, tint: CoinTint = "gold"): void {
  const t = TINTS[tint];
  const squash = Math.max(0.14, Math.abs(Math.cos(turn)));
  const edgeSide = Math.sin(turn) >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(x, y);

  // Edge: a slightly offset darker disc shows the coin's thickness.
  ctx.beginPath();
  ctx.ellipse(edgeSide * r * 0.12 * (1 - squash + 0.3), r * 0.05, r * squash, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = t.edge;
  ctx.fill();

  // Face.
  const g = ctx.createRadialGradient(-r * 0.35 * squash, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, t.hi);
  g.addColorStop(0.45, t.mid);
  g.addColorStop(1, t.lo);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * squash, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Raised rim and inner ring.
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.strokeStyle = t.rim;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.76 * squash, r * 0.76, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Shine.
  if (squash > 0.35) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.32 * squash, -r * 0.42, r * 0.26 * squash, r * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fill();
  }
  ctx.restore();
}

/** Fit a canvas to its box at the device pixel ratio; returns CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
