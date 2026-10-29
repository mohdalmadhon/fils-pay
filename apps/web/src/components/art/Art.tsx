/**
 * FilsPay's illustration set: "pearl & tide".
 *
 * Bahrain's economy ran on pearls and the sea long before card payments, and
 * the fils is its smallest coin. Every piece of art here comes from that
 * world: a nacre pearl (the brand mark), Gulf tide lines, a dhow on the
 * horizon, oyster shells. All inline SVG, coloured from CSS custom
 * properties so it follows the theme, and decorative (aria-hidden) unless a
 * title is passed.
 */
import { useId, type ReactNode } from "react";

interface ArtProps {
  className?: string;
  title?: string;
}

function svgA11y(title: string | undefined) {
  return title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const, focusable: false as const };
}

/** The nacre gradient every pearl uses. ids are per-instance so several
 *  pearls on one page never clash. */
function NacreDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-nacre`} cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="35%" stopColor="#f3eef6" />
        <stop offset="62%" stopColor="#dfe9ee" />
        <stop offset="85%" stopColor="#c6d6dc" />
        <stop offset="100%" stopColor="#a9bcc4" />
      </radialGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f9d9e6" stopOpacity="0.55" />
        <stop offset="50%" stopColor="#d6f0ee" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#e7e0fa" stopOpacity="0.5" />
      </linearGradient>
    </defs>
  );
}

export function Pearl({ className, title, size = 40 }: ArtProps & { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" {...svgA11y(title)}>
      <NacreDefs id={id} />
      <circle cx="20" cy="20" r="18" fill={`url(#${id}-nacre)`} />
      <circle cx="20" cy="20" r="18" fill={`url(#${id}-sheen)`} />
      <ellipse cx="13.5" cy="12.5" rx="5" ry="3.2" fill="#fff" opacity="0.85" transform="rotate(-30 13.5 12.5)" />
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="#7d97a0" strokeOpacity="0.35" />
    </svg>
  );
}

/** Brand mark: a pearl resting in the lip of an open shell. */
export function BrandMark({ className, size = 36 }: ArtProps & { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable={false}>
      <NacreDefs id={id} />
      <path d="M4 30c4 10 12 14 20 14s16-4 20-14c-7 3-13 4-20 4S11 33 4 30Z" fill="var(--fp-gold, #c79a2b)" />
      <path d="M4 30c7 3 13 4 20 4s13-1 20-4" fill="none" stroke="var(--fp-gold-deep, #8f6c17)" strokeWidth="1.5" />
      <circle cx="24" cy="21" r="13" fill={`url(#${id}-nacre)`} />
      <circle cx="24" cy="21" r="13" fill={`url(#${id}-sheen)`} />
      <ellipse cx="19.5" cy="15.5" rx="3.6" ry="2.3" fill="#fff" opacity="0.9" transform="rotate(-30 19.5 15.5)" />
    </svg>
  );
}

export function Wordmark({ className }: ArtProps) {
  return (
    <span className={["fp-wordmark", className].filter(Boolean).join(" ")}>
      <BrandMark size={34} />
      <span className="fp-wordmark-text">
        Fils<span>Pay</span>
      </span>
    </span>
  );
}

/** Layered tide lines. `animated` lets them drift (CSS handles
 *  prefers-reduced-motion). */
export function Tide({ className, animated = false }: ArtProps & { animated?: boolean }) {
  const wave = (y: number, amp: number) =>
    `M0 ${y} ` +
    Array.from({ length: 8 }, (_, i) => {
      const x = i * 100;
      return `Q ${x + 25} ${y - amp} ${x + 50} ${y} T ${x + 100} ${y}`;
    }).join(" ");
  return (
    <svg
      className={["fp-tide", animated ? "fp-tide-animated" : "", className].filter(Boolean).join(" ")}
      viewBox="0 0 400 120"
      preserveAspectRatio="none"
      aria-hidden
      focusable={false}
    >
      <g className="fp-tide-layer fp-tide-1">
        <path d={wave(40, 10)} fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      </g>
      <g className="fp-tide-layer fp-tide-2">
        <path d={wave(62, 14)} fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      </g>
      <g className="fp-tide-layer fp-tide-3">
        <path d={`${wave(86, 12)} L 800 120 L 0 120 Z`} fill="currentColor" opacity="0.18" />
      </g>
    </svg>
  );
}

/** A dhow under sail: the Gulf's trading boat. */
export function Dhow({ className, title }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 120 90" {...svgA11y(title)}>
      <path d="M58 8v58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M58 10c-18 10-30 30-36 52h36Z" fill="currentColor" opacity="0.9" />
      <path d="M62 22c12 8 20 22 22 40H62Z" fill="currentColor" opacity="0.55" />
      <path d="M10 66h100l-10 14H26Z" fill="currentColor" />
      <path d="M6 66h10M104 66h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** The deep-sea scene behind login and checkout: horizon dhow, rising
 *  pearls, drifting tide. Purely decorative. */
export function SeaScene({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={["fp-sea", className].filter(Boolean).join(" ")}>
      <div className="fp-sea-sky" aria-hidden />
      <Dhow className="fp-sea-dhow" />
      <div className="fp-sea-pearls" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className={`fp-sea-pearl fp-sea-pearl-${i}`}>
            <Pearl size={10 + (i % 3) * 7} />
          </span>
        ))}
      </div>
      <Tide className="fp-sea-tide" animated />
      {children ? <div className="fp-sea-content">{children}</div> : null}
    </div>
  );
}

export type SceneName = "empty" | "lost" | "locked" | "storm" | "lowtide" | "success" | "waiting";

/** Spot illustrations for empty, error and outcome states. */
export function Scene({ name, className }: { name: SceneName; className?: string }) {
  const id = useId().replace(/:/g, "");
  const cls = ["fp-scene", `fp-scene-${name}`, className].filter(Boolean).join(" ");
  const water = (
    <path
      d="M0 112 Q 20 104 40 112 T 80 112 T 120 112 T 160 112 T 200 112 V140 H0Z"
      fill="var(--fp-lagoon-soft, #cfe5e3)"
    />
  );
  switch (name) {
    case "empty":
      // An open, empty oyster: nothing here yet.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          {water}
          <path d="M40 96c10 18 34 26 60 26s50-8 60-26c-18 6-38 9-60 9s-42-3-60-9Z" fill="var(--fp-gold, #c79a2b)" />
          <path d="M40 96C44 58 70 38 100 38s56 20 60 58c-18-6-38-9-60-9s-42 3-60 9Z" fill="#e8d6a6" />
          <path d="M100 40v46M78 46l10 40M122 46l-10 40M58 60l22 30M142 60l-22 30" stroke="#c9b27a" strokeWidth="1.5" />
          <ellipse cx="100" cy="100" rx="22" ry="5" fill="#fff" opacity="0.6" />
        </svg>
      );
    case "lost":
      // A dhow adrift with no land in sight: page not found.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <circle cx="160" cy="30" r="12" fill="var(--fp-gold, #c79a2b)" opacity="0.35" />
          {water}
          <g transform="translate(55 30) rotate(-8 45 50)" color="var(--fp-abyss, #0b2e35)">
            <Dhow />
          </g>
          <path d="M30 124 q10-6 20 0 M150 128 q10-6 20 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <text x="24" y="40" fontSize="20" fill="var(--fp-abyss, #0b2e35)" opacity="0.35" fontWeight="700">?</text>
        </svg>
      );
    case "locked":
      // A closed oyster with its pearl inside: not permitted.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <NacreDefs id={id} />
          {water}
          <path d="M44 92c8 20 32 30 56 30s48-10 56-30c-16 7-36 10-56 10s-40-3-56-10Z" fill="var(--fp-gold, #c79a2b)" />
          <path d="M44 92c6-26 30-40 56-40s50 14 56 40c-16 7-36 10-56 10s-40-3-56-10Z" fill="#e8d6a6" />
          <path d="M44 92c16 7 36 10 56 10s40-3 56-10" stroke="var(--fp-gold-deep, #8f6c17)" strokeWidth="2" fill="none" />
          <circle cx="100" cy="98" r="6" fill={`url(#${id}-nacre)`} />
          <rect x="88" y="26" width="24" height="20" rx="4" fill="var(--fp-abyss, #0b2e35)" />
          <path d="M93 26v-5a7 7 0 0 1 14 0v5" stroke="var(--fp-abyss, #0b2e35)" strokeWidth="3" fill="none" />
        </svg>
      );
    case "storm":
      // Rough water and a cloud: something on our side or the network failed.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <path d="M60 52a18 18 0 0 1 34-8 16 16 0 0 1 30 6 13 13 0 0 1 2 26H64a12 12 0 0 1-4-24Z" fill="#9fb4bb" />
          <path d="M100 78l-8 16h10l-6 16 16-22h-10l6-10Z" fill="var(--fp-gold, #c79a2b)" />
          <path d="M0 116 Q 15 100 30 116 T 60 116 T 90 116 T 120 116 T 150 116 T 180 116 T 210 116 V140 H0Z" fill="var(--fp-coral-soft, #f4d3d1)" />
          <path d="M0 124 Q 15 110 30 124 T 60 124 T 90 124 T 120 124 T 150 124 T 180 124 T 210 124 V140 H0Z" fill="var(--fp-lagoon-soft, #cfe5e3)" />
        </svg>
      );
    case "lowtide":
      // The tide has gone out: expired.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <path d="M0 108 Q 50 96 100 104 T 200 100 V140 H0Z" fill="#ead9ad" />
          <path d="M120 120 Q 160 110 200 116 V140 H120Z" fill="var(--fp-lagoon-soft, #cfe5e3)" />
          <circle cx="50" cy="36" r="16" fill="var(--fp-gold, #c79a2b)" opacity="0.4" />
          <path d="M62 112c4-6 12-6 16 0" stroke="#c9b27a" strokeWidth="2" fill="none" />
          <path d="M84 70h28M98 56v28" stroke="var(--fp-abyss, #0b2e35)" strokeWidth="3" strokeLinecap="round" opacity="0.25" />
          <circle cx="98" cy="70" r="20" fill="none" stroke="var(--fp-abyss, #0b2e35)" strokeWidth="3" opacity="0.35" />
          <path d="M98 70V58M98 70l8 6" stroke="var(--fp-abyss, #0b2e35)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "success":
      // A pearl surfacing from the shell: paid.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <NacreDefs id={id} />
          {water}
          <path d="M50 100c8 16 28 24 50 24s42-8 50-24c-15 5-31 8-50 8s-35-3-50-8Z" fill="var(--fp-gold, #c79a2b)" />
          <circle className="fp-scene-rise" cx="100" cy="64" r="26" fill={`url(#${id}-nacre)`} />
          <circle className="fp-scene-rise" cx="100" cy="64" r="26" fill={`url(#${id}-sheen)`} />
          <path className="fp-scene-rise" d="M88 64l8 8 16-16" stroke="var(--fp-lagoon, #147a78)" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "waiting":
      // Pearls in a slow loop: loading.
      return (
        <svg className={cls} viewBox="0 0 120 40" aria-hidden focusable={false}>
          <NacreDefs id={id} />
          {[30, 60, 90].map((cx, i) => (
            <circle key={cx} className={`fp-wait-dot fp-wait-dot-${i}`} cx={cx} cy="20" r="9" fill={`url(#${id}-nacre)`} stroke="#9fb4bb" strokeOpacity="0.5" />
          ))}
        </svg>
      );
  }
}
