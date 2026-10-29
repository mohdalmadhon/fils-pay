/**
 * A small dependency-free area chart: a smooth line that draws itself in,
 * a light accent wash under it, and a crosshair with a tooltip that follows the
 * pointer (or arrow keys when focused). The data table on the page stays the
 * accessible source; the chart carries a one-line summary as its label.
 */
import { useMemo, useState } from "react";

export interface ChartPoint {
  label: string;
  value: number;
}

const W = 640;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

/** Catmull-Rom through the points, as cubic Bezier segments. */
function smooth(pts: Array<[number, number]>): string {
  if (pts.length === 1) return `M${pts[0]![0]} ${pts[0]![1]}`;
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function AreaChart({ points, format, label }: { points: ChartPoint[]; format: (value: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.value));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const xy = points.map((p, i): [number, number] => [
      PAD.left + (points.length > 1 ? i * step : innerW / 2),
      PAD.top + innerH - (p.value / max) * innerH,
    ]);
    const line = smooth(xy);
    const area = `${line} L${xy[xy.length - 1]![0]} ${H - PAD.bottom} L${xy[0]![0]} ${H - PAD.bottom} Z`;
    return { xy, line, area, max };
  }, [points]);

  if (points.length === 0) return null;
  const active = hover !== null ? geo.xy[hover] : null;
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div
      className="fp-chart"
      tabIndex={0}
      role="img"
      aria-label={label}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * W;
        let best = 0;
        geo.xy.forEach(([px], i) => {
          if (Math.abs(px - x) < Math.abs(geo.xy[best]![0] - x)) best = i;
        });
        setHover(best);
      }}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
        if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + (H - PAD.top - PAD.bottom) * f} y2={PAD.top + (H - PAD.top - PAD.bottom) * f} className="fp-chart-grid" />
        ))}
        <path d={geo.area} className="fp-chart-area" />
        <path d={geo.line} fill="none" strokeWidth="2" strokeLinecap="round" pathLength={1} className="fp-chart-line" vectorEffect="non-scaling-stroke" />
        {active ? <line x1={active[0]} x2={active[0]} y1={PAD.top} y2={H - PAD.bottom} className="fp-chart-cross" /> : null}
      </svg>
      {active ? (
        <>
          <span className="fp-chart-dot" style={{ left: `${(active[0] / W) * 100}%`, top: `${(active[1] / H) * 100}%` }} />
          <span
            className="fp-chart-tip"
            data-side={active[0] > W * 0.7 ? "left" : "right"}
            style={{ left: `${(active[0] / W) * 100}%`, top: `${(active[1] / H) * 100}%` }}
          >
            <strong>{format(points[hover!]!.value)}</strong>
            <span>{points[hover!]!.label}</span>
          </span>
        </>
      ) : null}
      <div className="fp-chart-axis" aria-hidden>
        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <span key={p.label} style={{ left: `${(geo.xy[i]![0] / W) * 100}%` }}>
              {p.label.slice(5)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
