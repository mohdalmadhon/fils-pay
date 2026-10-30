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
 *   Halloween shown instead of all three in the costume: a moon, a
 *             haunted house on its hill, bats, a ghost and pumpkins
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

      <g className="fp-art-halloween">
        <defs>
          <radialGradient id="fp-art-hw-moon" cx="40%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#fff6cf" />
            <stop offset="70%" stopColor="#ffd96b" />
            <stop offset="100%" stopColor="#f0b43a" />
          </radialGradient>
          <radialGradient id="fp-art-hw-halo">
            <stop offset="50%" stopColor="#ffd23f" stopOpacity=".3" />
            <stop offset="100%" stopColor="#ffd23f" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fp-art-hw-pumpkin" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#ffb25c" />
            <stop offset="60%" stopColor="#ff7a1a" />
            <stop offset="100%" stopColor="#c2410c" />
          </radialGradient>
        </defs>
        <circle cx="200" cy="78" r="76" fill="url(#fp-art-hw-halo)" />
        <circle cx="200" cy="78" r="50" fill="url(#fp-art-hw-moon)" />
        <g fill="#e0a91c" opacity=".5">
          <circle cx="216" cy="92" r="9" />
          <circle cx="186" cy="100" r="5" />
          <circle cx="210" cy="60" r="4" />
        </g>
        {/* The hill and the haunted house against the moon. */}
        <path d="M110 220c30-50 90-72 160-72s50 30 50 72Z" fill="#170e29" />
        <g fill="#120a1c">
          <path d="M178 160v-38l24-22 24 22v38Z" />
          <path d="M164 160v-56h16v56Z" />
          <path d="M160 106l12-30 12 30Z" />
          <path d="M222 160v-28l18-16 18 16v28Z" />
        </g>
        <g fill="#ffd23f" className="fp-art-hw-windows">
          <rect x="168" y="118" width="8" height="10" rx="4" />
          <rect x="190" y="128" width="8" height="10" />
          <rect x="206" y="128" width="8" height="10" />
          <rect x="234" y="134" width="10" height="9" />
          <rect x="196" y="146" width="10" height="14" rx="5" />
        </g>
        {/* Bats across the moon. */}
        <g fill="#120a1c">
          <path d="M120 40c-6-6-14-7-22-3 3 1 4 3 3 6 3-2 6-2 8 0 1-2 3-3 6-2 1-2 3-2 5-1 2-1 4-1 6 2 1-3 3-4 6-2 2-2 5-2 8 0-1-3 0-5 3-6-8-4-16-3-22 3l-1 4Z" />
          <path d="M262 30c-4-4-10-5-15-2 2 1 3 2 2 4 2-1 4-1 5 0 1-1 2-2 4-1h3c1-1 3-1 4 1 1-2 2-2 4-1 1-1 3-1 5 0 0-2 1-3 2-4-5-3-10-2-14 2v1Z" />
        </g>
        {/* A ghost floating up on the left. */}
        <path d="M60 60c-14 0-22 10-22 24v40l7-6 7 6 8-6 8 6 7-6 7 6V84c0-14-8-24-22-24Z" fill="#f4eefc" />
        <ellipse cx="53" cy="86" rx="3.4" ry="4.6" fill="#1b1230" />
        <ellipse cx="68" cy="86" rx="3.4" ry="4.6" fill="#1b1230" />
        <ellipse cx="60.5" cy="98" rx="3" ry="3.6" fill="#1b1230" />
        {/* Two jack-o'-lanterns on the ground. */}
        <g transform="translate(40 168)">
          <ellipse cx="18" cy="22" rx="20" ry="18" fill="url(#fp-art-hw-pumpkin)" />
          <path d="M18 5c0-4 2-7 5-8" stroke="#4c7a2a" strokeWidth="3" fill="none" />
          <path d="M8 18l4-5 4 5ZM20 18l4-5 4 5ZM7 26c4 6 18 6 22 0-2 1-4 0-5 2-1-1-3-1-4 0-1-1-3-1-4 0-1-2-3-1-4-2Z" fill="#ffd23f" />
        </g>
        <g transform="translate(84 186) scale(.7)">
          <ellipse cx="18" cy="22" rx="20" ry="18" fill="url(#fp-art-hw-pumpkin)" />
          <path d="M18 5c0-4 2-7 5-8" stroke="#4c7a2a" strokeWidth="3" fill="none" />
          <path d="M8 18l4-5 4 5ZM20 18l4-5 4 5ZM7 26c4 6 18 6 22 0-2 1-4 0-5 2-1-1-3-1-4 0-1-1-3-1-4 0-1-2-3-1-4-2Z" fill="#ffd23f" />
        </g>
      </g>
    </svg>
  );
}
