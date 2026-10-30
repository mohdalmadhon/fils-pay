/**
 * Vector art for the Halloween costume: a storybook night drawn in SVG,
 * with gradients and glows rather than flat shapes. Each component's
 * viewBox matches the box it is placed in (Halloween.tsx, theme.css), so
 * it scales cleanly. Gradient ids come from useId(), so several copies on
 * one page don't clash. All decorative (aria-hidden on the layers that
 * hold them).
 */
import { useId } from "react";

const svgProps = { "aria-hidden": true, focusable: false } as const;

/** A jack-o'-lantern. Lit: a candle glows through the carved face. */
export function Pumpkin({ lit = true, className }: { lit?: boolean; className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 36 32" {...svgProps}>
      <defs>
        <radialGradient id={`${id}-skin`} cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#ffb25c" />
          <stop offset="60%" stopColor="#ff7a1a" />
          <stop offset="100%" stopColor="#c2410c" />
        </radialGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="55%" stopColor="#ffd23f" />
          <stop offset="100%" stopColor="#ff9b1a" />
        </radialGradient>
      </defs>
      {/* Stem and a curling leaf. */}
      <path d="M17.5 7.5c-.2-2.6.6-4.6 2.6-5.8l1.4 1.3c-1.5 1-2 2.5-1.8 4.6Z" fill="#4c7a2a" />
      <path d="M20.5 4.2c2.8-1.7 5.7-1.2 7.2.6-2.4.9-4.8.7-7.2-.6Z" fill="#8fe36b" />
      {/* Four ribs, back to front. */}
      <g fill={`url(#${id}-skin)`} stroke="#8a2f05" strokeWidth=".6">
        <ellipse cx="9.5" cy="18.5" rx="8.5" ry="11" />
        <ellipse cx="26.5" cy="18.5" rx="8.5" ry="11" />
        <ellipse cx="14" cy="19" rx="7" ry="11.6" />
        <ellipse cx="22" cy="19" rx="7" ry="11.6" />
      </g>
      <path d="M8 12c-1 2.5-1.2 6 0 9" stroke="#ffd0a0" strokeOpacity=".55" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* The carved face. */}
      <g fill={lit ? `url(#${id}-glow)` : "#4a1d06"}>
        <path d="M9 15.5l3.4-4 3.1 4Z" />
        <path d="M20.5 15.5l3.1-4 3.4 4Z" />
        <path d="M16.8 18.6l1.2-1.8 1.2 1.8Z" />
        <path d="M8.5 21.2c2.3 4 16.7 4 19 0-1.5.5-2.4.1-3.1 1.6-.8-1-1.7-1-2.4 0-.8-1.2-1.7-1.2-2.5 0-.8-1.2-1.7-1.2-2.5 0-.7-1-1.6-1-2.4 0-.8-1.5-1.6-1.1-3.1-1.6Z" />
      </g>
    </svg>
  );
}

/** A bat. Its wings are separate so CSS can flap them from the shoulder. */
export function Bat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 30" {...svgProps}>
      <g className="fp-hw-wing fp-hw-wing-l">
        <path d="M30 14C24 5 13 3 1 8c4 1.5 5.5 4.6 4.6 8.4 3.2-2.4 6.6-2.5 9 .4.9-3 3.9-4.4 7.3-3 1.5-2.5 4.6-3 8.1.2Z" />
      </g>
      <g className="fp-hw-wing fp-hw-wing-r">
        <path d="M30 14c6-9 17-11 29-6-4 1.5-5.5 4.6-4.6 8.4-3.2-2.4-6.6-2.5-9 .4-.9-3-3.9-4.4-7.3-3-1.5-2.5-4.6-3-8.1.2Z" />
      </g>
      <ellipse cx="30" cy="16" rx="4.6" ry="6.4" />
      <path d="M26.6 10.6l.9-4.2 2 3.2ZM33.4 10.6l-.9-4.2-2 3.2Z" />
      <circle cx="28.4" cy="13.4" r="1" fill="#ffd23f" />
      <circle cx="31.6" cy="13.4" r="1" fill="#ffd23f" />
      <path d="M28.9 16.4l.5 1 .6-1M30 16.4l.6 1 .5-1" stroke="#f7efe0" strokeWidth=".5" fill="none" />
    </svg>
  );
}

/** A friendly ghost; frame "b" moves its hem, for a slow wiggle. */
export function Ghost({ frame = "a", className }: { frame?: "a" | "b"; className?: string }) {
  const id = useId();
  // Six scallops along the hem, left to right; frame "b" swaps which dip.
  const up = "q3 5 6 0";
  const down = "q3 -3 6 0";
  const hem = (frame === "a" ? [up, down, up, down, up, down] : [down, up, down, up, down, up]).join(" ");
  return (
    <svg className={className} viewBox="0 0 48 54" {...svgProps}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f1ebfb" />
          <stop offset="100%" stopColor="#d6c8f2" />
        </linearGradient>
      </defs>
      <path d={`M24 3C12.6 3 6 11.4 6 23v24 ${hem} V23C42 11.4 35.4 3 24 3Z`} fill={`url(#${id}-body)`} stroke="#b9a6e3" strokeWidth=".8" />
      <ellipse cx="17.5" cy="22" rx="3" ry="4.2" fill="#1b1230" />
      <ellipse cx="30.5" cy="22" rx="3" ry="4.2" fill="#1b1230" />
      <circle cx="18.6" cy="20.4" r="1.1" fill="#fff" />
      <circle cx="31.6" cy="20.4" r="1.1" fill="#fff" />
      <ellipse cx="24" cy="31" rx="2.6" ry="3.2" fill="#1b1230" />
      <ellipse cx="12.5" cy="28" rx="2.6" ry="1.6" fill="#ff9fb0" opacity=".7" />
      <ellipse cx="35.5" cy="28" rx="2.6" ry="1.6" fill="#ff9fb0" opacity=".7" />
    </svg>
  );
}

/** A round spider with an orange hourglass, legs bent at the knee. */
export function Spider({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 45 36" {...svgProps}>
      <g stroke="#120a1c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="fp-hw-legs">
        <path d="M17 16l-7-6-6 2M16 20l-9-2-6 5M17 24l-7 4-3 6M19 26l-4 6" />
        <path d="M28 16l7-6 6 2M29 20l9-2 6 5M28 24l7 4 3 6M26 26l4 6" />
      </g>
      <ellipse cx="22.5" cy="22" rx="8" ry="8.6" fill="#120a1c" />
      <circle cx="22.5" cy="12" r="5" fill="#120a1c" />
      <circle cx="20.6" cy="11.2" r="1.3" fill="#ff5c6c" />
      <circle cx="24.4" cy="11.2" r="1.3" fill="#ff5c6c" />
      <path d="M20.5 19h4l-2 3 2 3h-4l2-3Z" fill="#ff7a1a" />
      <ellipse cx="19.6" cy="19.4" rx="2" ry="1.2" fill="#ffffff" opacity=".12" />
    </svg>
  );
}

/** A full moon with craters and a soft halo. */
export function Moon({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 72 72" {...svgProps}>
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop offset="55%" stopColor="#ffd23f" stopOpacity=".35" />
          <stop offset="100%" stopColor="#ffd23f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-face`} cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff6cf" />
          <stop offset="65%" stopColor="#ffd96b" />
          <stop offset="100%" stopColor="#f0b43a" />
        </radialGradient>
      </defs>
      <circle cx="36" cy="36" r="36" fill={`url(#${id}-halo)`} />
      <circle cx="36" cy="36" r="24" fill={`url(#${id}-face)`} />
      <g fill="#e0a91c" opacity=".55">
        <circle cx="44" cy="42" r="4.6" />
        <circle cx="29" cy="46" r="2.8" />
        <circle cx="41" cy="27" r="2.2" />
        <circle cx="27" cy="31" r="1.8" />
      </g>
    </svg>
  );
}

/** A corner cobweb: spokes from the corner joined by sagging threads. */
export function Cobweb({ className }: { className?: string }) {
  const spokes = [0, 18, 36, 54, 72, 90];
  const rings = [26, 52, 82, 116];
  const pt = (r: number, deg: number) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r] as const;
  return (
    <svg className={className} viewBox="0 0 144 144" fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" {...svgProps}>
      {spokes.map((deg) => {
        const [x, y] = pt(150, deg);
        return <path key={deg} d={`M0 0L${x.toFixed(1)} ${y.toFixed(1)}`} />;
      })}
      {rings.map((r) => (
        <path
          key={r}
          d={spokes
            .slice(0, -1)
            .map((deg, i) => {
              const [x1, y1] = pt(r, deg);
              const [x2, y2] = pt(r, spokes[i + 1]!);
              const [cx, cy] = pt(r * 0.84, deg + 9);
              return `${i === 0 ? `M${x1.toFixed(1)} ${y1.toFixed(1)}` : ""} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
            })
            .join(" ")}
        />
      ))}
    </svg>
  );
}

/** A witch on a broom, flying right: a silhouette with a moonlit rim. */
export function Witch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 84 45" {...svgProps}>
      {/* Broom: straw tail and handle. */}
      <path d="M2 30c6-6 14-7 20-4l-1 5c-6-2-12-1-19 3Z" fill="#ffa24c" />
      <path d="M4 33l17-3M5 28l16 0" stroke="#c2410c" strokeWidth=".8" />
      <path d="M20 29.5l62-4" stroke="#7a4a24" strokeWidth="2.4" strokeLinecap="round" />
      {/* Cape streaming back, body and boots. */}
      <path d="M44 16c-8 1-16 6-22 13 7-2 12-2 18 1Z" fill="#4b2470" />
      <path d="M40 17c4-2 8-2 10 2l3 9-4 2-2-5-3 6-5-1 1-13Z" fill="#160d24" />
      <path d="M46 31l6 6 4-1-6-7Z" fill="#160d24" />
      {/* Head, nose and the hat with its purple band. */}
      <circle cx="48" cy="14" r="3.6" fill="#3f8f2a" />
      <path d="M51 14l4 1.4-3.6.8Z" fill="#3f8f2a" />
      <path d="M38 12.5l20-2-5-2.2L48 1 44 10Z" fill="#160d24" />
      <path d="M44.6 9.3l7.6-.9.6 1.6-8.6.9Z" fill="#b45cf0" />
      <path d="M41 13l15-1.6" stroke="#b45cf0" strokeOpacity=".5" strokeWidth=".6" />
    </svg>
  );
}

/** A soft cloud, for drifting across the moon. */
export function Cloud({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 160 56" {...svgProps}>
      <defs>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b4a85" />
          <stop offset="100%" stopColor="#2e2148" />
        </linearGradient>
      </defs>
      <path
        d="M18 48c-10 0-16-6-14-13s10-9 16-7c1-9 10-15 20-12 4-9 16-13 26-7 6-8 20-8 26 1 9-3 19 2 20 11 10-1 18 5 17 14-1 8-8 13-17 13Z"
        fill={`url(#${id}-c)`}
      />
      <path d="M40 22c3-6 10-8 15-6M86 14c5-3 11-2 14 2" stroke="#8f7cc2" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

/** One bare tree, branching, drawn in strokes that thin toward the tips. */
function Tree({ x, scale = 1, flip = false }: { x: number; scale?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} 260) scale(${flip ? -scale : scale} ${scale})`} stroke="#120a1c" strokeLinecap="round" fill="none">
      <path d="M0 0c2-40-6-80 4-120" strokeWidth="9" />
      <path d="M2-60c-18-10-30-24-34-44M-14-88c-8-4-12-10-14-18" strokeWidth="5" />
      <path d="M4-90c16-12 26-26 28-46M22-118c8-2 14-8 16-16" strokeWidth="4" />
      <path d="M4-118c-6-14-4-26 4-36M6-134c6-6 14-8 20-6" strokeWidth="3" />
      <path d="M-32-104c-10-2-16 2-22 8M28-136c4-10 2-18-4-24" strokeWidth="2" />
    </g>
  );
}

/** A rounded tombstone with RIP carved in, lit faintly from the left. */
function Tombstone({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0v-30c0-11 8-19 18-19s18 8 18 19V0Z" fill="#3a2d55" />
      <path d="M2 0v-30c0-10 7-17 16-17" stroke="#6d5a99" strokeWidth="1.5" fill="none" />
      <text x="18" y="-22" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1e1530" fontFamily="Georgia, serif">
        RIP
      </text>
      <path d="M8-12h20M10-7h16" stroke="#1e1530" strokeWidth="1.4" />
    </g>
  );
}

function Cross({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${scale})`}
      d="M-3 0v-26h-9v-6h9v-9h6v9h9v6H3V0Z"
      fill="#3a2d55"
    />
  );
}

/**
 * The night scene along the bottom of the page: far hills, a haunted house
 * with lit windows on its hill, bare trees, an iron fence, a graveyard of
 * tombstones and crosses, and a black cat on a tombstone who blinks.
 * Stretches to any width (xMidYMax slice); the house stays on the right.
 */
export function NightScene({ className }: { className?: string }) {
  const id = useId();
  const fence = Array.from({ length: 16 }, (_, i) => 360 + i * 14);
  return (
    <svg className={className} viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" {...svgProps}>
      <defs>
        <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b2766" />
          <stop offset="100%" stopColor="#1d1236" />
        </linearGradient>
        <radialGradient id={`${id}-window`}>
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="100%" stopColor="#ff9b1a" />
        </radialGradient>
      </defs>

      {/* Far hills. */}
      <path d="M0 200c120-50 260-60 420-30s300 10 420-30 300-60 600-10v130H0Z" fill={`url(#${id}-far)`} opacity=".9" />

      {/* The haunted house on its hill, right of centre. */}
      <path d="M940 260c40-70 120-100 220-100s190 40 280 100Z" fill="#170e29" />
      <g fill="#120a1c">
        <path d="M1070 168v-60l40-36 40 36v60Z" />
        <path d="M1140 168v-46l-6-2 34-30 34 30-6 2v46Z" />
        {/* The tower, with its spire. */}
        <path d="M1046 168v-92h28v92Z" />
        <path d="M1040 78l20-52 20 52Z" />
        <path d="M1059 26v-10" stroke="#120a1c" strokeWidth="2" />
        <path d="M1150 100h12v-26h-12Z" />
      </g>
      <g className="fp-hw-windows" fill={`url(#${id}-window)`}>
        <rect x="1053" y="96" width="14" height="18" rx="7" />
        <rect x="1086" y="120" width="14" height="16" />
        <rect x="1120" y="120" width="14" height="16" />
        <path d="M1100 104a10 10 0 0 1 20 0Z" />
        <rect x="1160" y="128" width="16" height="14" />
        <rect x="1098" y="146" width="16" height="22" rx="8" />
      </g>
      <path d="M1093 128h8M1127 128h8M1168 128v14M1160 135h16" stroke="#120a1c" strokeWidth="1.5" />

      {/* Bare trees: one on the left, one by the house. */}
      <Tree x={160} scale={1.05} />
      <Tree x={1300} scale={0.9} flip />

      {/* Near ground, with a bump for the graveyard. */}
      <path d="M0 236c80-14 160-18 240-10s200 14 320 4 240-20 380-10 340 30 500 18v22H0Z" fill="#120a1c" />

      {/* An iron fence with pointed posts. */}
      <g stroke="#2c1f45" strokeWidth="3" fill="#2c1f45">
        <path d="M356 216h226M356 236h226" strokeWidth="2.5" fill="none" />
        {fence.map((fx) => (
          <path key={fx} d={`M${fx} 240v-34l3-6 3 6v34Z`} strokeWidth="0" />
        ))}
      </g>

      {/* The graveyard. */}
      <Tombstone x={40} y={240} />
      <Cross x={110} y={236} />
      <Tombstone x={250} y={236} scale={0.85} />
      <Tombstone x={640} y={242} scale={1.1} />
      <Cross x={720} y={236} scale={0.9} />
      <Tombstone x={820} y={238} scale={0.9} />
      <Cross x={1380} y={238} />

      {/* A black cat on the big tombstone; its eyes blink. */}
      <g transform="translate(660 190)">
        <path d="M12 2c-6 0-10 4-10 10 0 4 2 7 4 9-3 3-4 7-2 9h20c2-3 1-7-2-10 3-2 4-5 4-8 0-6-4-10-10-10l-2-6-3 6Z" fill="#05030a" />
        <path d="M5 2l2-8 5 6M19 2l-2-8-5 6" fill="#05030a" />
        <path d="M24 28c10-2 14-10 10-18" stroke="#05030a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <g className="fp-hw-cat-eyes" fill="#8fe36b">
          <ellipse cx="8.5" cy="8" rx="1.8" ry="2.2" />
          <ellipse cx="15.5" cy="8" rx="1.8" ry="2.2" />
        </g>
      </g>
    </svg>
  );
}
