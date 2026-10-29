/**
 * FilsPay's name and its small state illustrations.
 *
 * There is no logo: the product name is set as type. The illustrations are
 * quiet line drawings on a 96x72 grid, 1.5px strokes in the current text
 * colour with one accent detail, so they sit inside the interface instead of
 * competing with it. All are decorative (aria-hidden).
 */

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={["fp-wordmark", className].filter(Boolean).join(" ")}>
      Fils<span>Pay</span>
      <span className="fp-wordmark-ops">Ops</span>
    </span>
  );
}

export type SceneName = "empty" | "lost" | "locked" | "storm" | "expired" | "success" | "waiting";

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Small line illustrations for empty, error and outcome states. */
export function Scene({ name, className }: { name: SceneName; className?: string }) {
  const cls = ["fp-scene", `fp-scene-${name}`, className].filter(Boolean).join(" ");

  switch (name) {
    case "empty":
      // Two ledger sheets, the top one blank but for a waiting cursor.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <g {...common}>
            <rect x="30" y="10" width="40" height="52" rx="3" opacity="0.45" />
            <rect x="24" y="14" width="40" height="52" rx="3" className="fp-scene-paper" />
            <path d="M32 26h18M32 34h24M32 42h12" opacity="0.5" />
          </g>
          <rect x="32" y="49" width="10" height="2.5" rx="1.25" className="fp-scene-accent fp-scene-blink" />
        </svg>
      );
    case "lost":
      // A link broken in two.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <g {...common}>
            <path d="M42 30l-6-6a8 8 0 0 0-11.3 11.3l6 6a8 8 0 0 0 11.3 0" />
            <path d="M54 42l6 6a8 8 0 0 0 11.3-11.3l-6-6a8 8 0 0 0-11.3 0" />
          </g>
          <g {...common} className="fp-scene-accent-stroke">
            <path d="M48 22v-6M56 26l4-4M40 50l-4 4M48 50v6" />
          </g>
        </svg>
      );
    case "locked":
      // A padlock with an accent keyhole.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <g {...common}>
            <rect x="32" y="32" width="32" height="26" rx="4" className="fp-scene-paper" />
            <path d="M38 32v-7a10 10 0 0 1 20 0v7" />
          </g>
          <path d="M48 41.5a3 3 0 0 1 1.5 5.6V51h-3v-3.9A3 3 0 0 1 48 41.5Z" className="fp-scene-accent" />
        </svg>
      );
    case "storm":
      // A line chart that fell over, with a warning mark.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <g {...common}>
            <path d="M16 58h64" opacity="0.4" />
            <path d="M18 44l12-10 10 6 10-14" />
            <path d="M50 26l4 22" strokeDasharray="2 4" opacity="0.6" />
          </g>
          <g {...common} className="fp-scene-accent-stroke">
            <path d="M68 18l11 20H57Z" />
            <path d="M68 26v5M68 34.5v.5" />
          </g>
        </svg>
      );
    case "expired":
      // A clock whose time ran out.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <g {...common}>
            <circle cx="48" cy="38" r="20" className="fp-scene-paper" />
            <path d="M48 26v12l8 5" />
            <path d="M44 12h8M48 12v6" />
          </g>
          <path d="M48 18a20 20 0 0 1 20 20" {...common} className="fp-scene-accent-stroke" strokeWidth={2.5} />
        </svg>
      );
    case "success":
      // A check that draws itself.
      return (
        <svg className={cls} viewBox="0 0 96 72" aria-hidden focusable={false}>
          <circle cx="48" cy="36" r="24" {...common} className="fp-scene-ring" pathLength={1} />
          <path d="M37 37l7 7 15-16" {...common} strokeWidth={2.5} className="fp-scene-check" pathLength={1} />
        </svg>
      );
    case "waiting":
      // A quiet spinner.
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden focusable={false}>
          <circle cx="12" cy="12" r="9" {...common} opacity="0.2" />
          <path d="M21 12a9 9 0 0 0-9-9" {...common} className="fp-scene-accent-stroke fp-spin" />
        </svg>
      );
  }
}
