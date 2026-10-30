/**
 * Illustrations for the three designs, drawn as SVG and coloured only
 * through the design's art tokens (--art-1 … --art-5), so each one follows
 * light and dark mode by itself. One component holds all three; CSS shows
 * the one for the current design (data-design on <html>).
 *
 *   Carnival  bold geometric shapes: half-discs, a diamond, a triangle,
 *             a quarter-circle with a dot, like a festival poster
 *   Blush     soft overlapping blobs and a sand-coloured card
 *   Slate     a line chart with a dot grid, drawn in strokes
 *
 * Decorative only (aria-hidden).
 */
export function DesignArt({ className }: { className?: string }) {
  return (
    <svg
      className={["fp-design-art", className].filter(Boolean).join(" ")}
      viewBox="0 0 320 220"
      aria-hidden
      focusable={false}
    >
      <g className="fp-art-carnival">
        {/* A large disc split into mint and sun halves. */}
        <path className="a3" d="M190 30a80 80 0 0 0 0 160Z" />
        <path className="a1" d="M190 30a80 80 0 0 1 0 160Z" />
        {/* A rose diamond with a white eye on its corner. */}
        <path className="a2" d="M190 70l40 40-40 40-40-40Z" />
        <circle className="paper" cx="190" cy="110" r="11" />
        {/* A peach triangle cutting in from the left. */}
        <path className="a4" d="M40 20h90L40 150Z" />
        {/* A sun quarter-circle with a mint dot, bottom left. */}
        <path className="a1" d="M40 220v-70a70 70 0 0 1 70 70Z" />
        <circle className="a3" cx="70" cy="196" r="12" />
        {/* A rose wave across the bottom right. */}
        <path className="a2" d="M250 220c10-30 30-40 70-40v40Z" />
        <circle className="a4" cx="290" cy="40" r="18" />
        <path className="a1 stroke" d="M262 132c14 6 22 18 24 34" />
      </g>

      <g className="fp-art-blush">
        <path className="a2" d="M210 20c48 0 92 30 92 76s-40 70-86 70-88-22-88-64 34-82 82-82Z" />
        <path className="a1" d="M80 70c38-8 76 14 78 52s-26 66-66 70-74-22-74-58 24-56 62-64Z" />
        <circle className="a3" cx="270" cy="170" r="30" />
        {/* A sand card, tilted, like the one in the brief. */}
        <g transform="rotate(-12 175 120)">
          <rect className="a4 card" x="120" y="85" width="120" height="76" rx="12" />
          <rect className="a1" x="134" y="100" width="22" height="16" rx="4" />
          <rect className="a5 faint" x="134" y="138" width="60" height="6" rx="3" />
          <rect className="a5 faint" x="200" y="138" width="24" height="6" rx="3" />
        </g>
        <circle className="a5" cx="56" cy="40" r="4" />
        <circle className="a5" cx="300" cy="96" r="3" />
      </g>

      <g className="fp-art-slate">
        {/* A dot grid, as in the brief's image 3. */}
        <g className="a3">
          {[0, 1, 2, 3, 4].flatMap((row) =>
            [0, 1, 2, 3, 4, 5].map((col) => <circle key={`${row}-${col}`} cx={196 + col * 22} cy={20 + row * 22} r="5" />),
          )}
        </g>
        {/* Bars and a rising line, drawn in strokes. */}
        <g className="stroke-only">
          <path className="s2" d="M30 190h270" />
          <rect className="s2" x="48" y="140" width="22" height="50" rx="3" />
          <rect className="s2" x="84" y="116" width="22" height="74" rx="3" />
          <rect className="s2" x="120" y="128" width="22" height="62" rx="3" />
          <path className="s1 thick" d="M40 120l50-30 40 18 60-56 50 22 50-40" />
          <circle className="a1" cx="290" cy="34" r="8" />
          <circle className="a4" cx="190" cy="52" r="6" />
        </g>
      </g>
    </svg>
  );
}
