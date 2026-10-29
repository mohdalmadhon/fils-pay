/**
 * FilsPay's illustration set: "desert dusk".
 *
 * Glossy, softly lit 3D-style sculptures in a plum-to-rose room at dusk:
 * sand-gold coins stacked on pedestals, a coin floating inside a glowing
 * apricot ring, rose and apricot spheres, dusky palm fronds. Everything is
 * inline SVG built from gradients, so it stays sharp at any size. There is
 * deliberately no logo anywhere: the product name is set as plain text.
 * Decorative (aria-hidden) unless a title is passed.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ArtProps {
  className?: string;
  title?: string;
}

const C = {
  plumDeep: "#3e1b36",
  plum: "#5b2a4e",
  rose: "#d9777f",
  roseDeep: "#b4566a",
  apricot: "#e8a87c",
  apricotDeep: "#c97f55",
  sand: "#e0b15a",
  sandDeep: "#b8862f",
  glow: "#ffc9a3",
};

function useSvgId(): string {
  return useId().replace(/:/g, "");
}

function a11y(title: string | undefined) {
  return title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const, focusable: false as const };
}

/* Shared gradients ------------------------------------------------------- */

function Defs({ id }: { id: string }) {
  return (
    <defs>
      {/* sand-gold coin face */}
      <radialGradient id={`${id}-gold`} cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#fff4d9" />
        <stop offset="35%" stopColor="#f0cb7e" />
        <stop offset="72%" stopColor={C.sand} />
        <stop offset="100%" stopColor="#9a6c22" />
      </radialGradient>
      {/* coin edge */}
      <linearGradient id={`${id}-goldEdge`} x1="0" x2="1">
        <stop offset="0%" stopColor="#8f631d" />
        <stop offset="40%" stopColor={C.sandDeep} />
        <stop offset="60%" stopColor="#f3d495" />
        <stop offset="100%" stopColor="#8f631d" />
      </linearGradient>
      {/* pedestal bodies, lit from the left */}
      <linearGradient id={`${id}-roseBody`} x1="0" x2="1">
        <stop offset="0%" stopColor="#f3c3c5" />
        <stop offset="45%" stopColor={C.rose} />
        <stop offset="100%" stopColor={C.roseDeep} />
      </linearGradient>
      <linearGradient id={`${id}-sandBody`} x1="0" x2="1">
        <stop offset="0%" stopColor="#f6dfae" />
        <stop offset="45%" stopColor={C.sand} />
        <stop offset="100%" stopColor={C.sandDeep} />
      </linearGradient>
      <linearGradient id={`${id}-plumBody`} x1="0" x2="1">
        <stop offset="0%" stopColor="#a5708f" />
        <stop offset="45%" stopColor={C.plum} />
        <stop offset="100%" stopColor={C.plumDeep} />
      </linearGradient>
      <linearGradient id={`${id}-apricotBody`} x1="0" x2="1">
        <stop offset="0%" stopColor="#f8d6bd" />
        <stop offset="45%" stopColor={C.apricot} />
        <stop offset="100%" stopColor={C.apricotDeep} />
      </linearGradient>
      {/* spheres */}
      <radialGradient id={`${id}-roseBall`} cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#fde3e3" />
        <stop offset="35%" stopColor="#e9979c" />
        <stop offset="75%" stopColor={C.rose} />
        <stop offset="100%" stopColor="#8f3a4f" />
      </radialGradient>
      <radialGradient id={`${id}-apricotBall`} cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#fff0e3" />
        <stop offset="35%" stopColor="#f2c19f" />
        <stop offset="75%" stopColor={C.apricot} />
        <stop offset="100%" stopColor="#a8603a" />
      </radialGradient>
      <radialGradient id={`${id}-plumBall`} cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#e6c8da" />
        <stop offset="35%" stopColor="#9c5f86" />
        <stop offset="75%" stopColor={C.plum} />
        <stop offset="100%" stopColor="#2a0f25" />
      </radialGradient>
      <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <radialGradient id={`${id}-shadow`}>
        <stop offset="0%" stopColor="#3e1b36" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#3e1b36" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

type Body = "rose" | "sand" | "plum" | "apricot";
const TOPS: Record<Body, string> = { rose: "#f7cfd1", sand: "#f9e6bd", plum: "#b98aa8", apricot: "#fbdcc6" };

/** A round pedestal: body, lit top, floor shadow. `y` is the top face. */
function Pedestal({ id, cx, y, r, h, body }: { id: string; cx: number; y: number; r: number; h: number; body: Body }) {
  const ry = r * 0.24;
  return (
    <g>
      <ellipse cx={cx + r * 0.25} cy={y + h + ry * 0.6} rx={r * 1.6} ry={ry * 1.4} fill={`url(#${id}-shadow)`} />
      <path d={`M${cx - r} ${y} V${y + h} A${r} ${ry} 0 0 0 ${cx + r} ${y + h} V${y} Z`} fill={`url(#${id}-${body}Body)`} />
      <ellipse cx={cx} cy={y} rx={r} ry={ry} fill={TOPS[body]} />
    </g>
  );
}

/** A stack of coins seen slightly from above. `y` is the bottom. */
function CoinStack({ id, cx, y, r, count }: { id: string; cx: number; y: number; r: number; count: number }) {
  const ry = r * 0.3;
  const t = Math.max(3, r * 0.18);
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const top = y - (i + 1) * t;
        const dx = (i % 2 === 0 ? 1 : -1) * r * 0.04;
        return (
          <g key={i}>
            <path d={`M${cx - r + dx} ${top} V${top + t} A${r} ${ry} 0 0 0 ${cx + r + dx} ${top + t} V${top} Z`} fill={`url(#${id}-goldEdge)`} />
            <ellipse cx={cx + dx} cy={top} rx={r} ry={ry} fill={`url(#${id}-gold)`} />
            <ellipse cx={cx + dx} cy={top} rx={r * 0.72} ry={ry * 0.72} fill="none" stroke="#9a6c22" strokeOpacity="0.4" strokeWidth={Math.max(0.8, r * 0.04)} />
          </g>
        );
      })}
    </g>
  );
}

/** An upright coin facing us, with a raised rim and no markings. */
function CoinFace({ id, cx, cy, r }: { id: string; cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx + r * 0.06} cy={cy} r={r} fill="#8f631d" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-gold)`} />
      <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke="#9a6c22" strokeOpacity="0.45" strokeWidth={r * 0.06} />
      <circle cx={cx} cy={cy} r={r * 0.5} fill="none" stroke="#9a6c22" strokeOpacity="0.2" strokeWidth={r * 0.04} />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.4} rx={r * 0.32} ry={r * 0.18} fill="#fff" opacity="0.55" transform={`rotate(-30 ${cx - r * 0.35} ${cy - r * 0.4})`} />
    </g>
  );
}

/** A glowing apricot ring tilted around a point. */
function GlowRing({ id, cx, cy, rx, ry, tilt = -14 }: { id: string; cx: number; cy: number; rx: number; ry: number; tilt?: number }) {
  return (
    <g transform={`rotate(${tilt} ${cx} ${cy})`} filter={`url(#${id}-glow)`}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={C.apricot} strokeWidth={Math.max(2, rx * 0.06)} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#fff1e4" strokeWidth={Math.max(0.8, rx * 0.02)} />
    </g>
  );
}

function Ball({ id, cx, cy, r, tone }: { id: string; cx: number; cy: number; r: number; tone: "rose" | "apricot" | "plum" }) {
  return <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-${tone}Ball)`} />;
}

/** Dusky palm fronds in a rose pot. */
function Palm({ id, x, y, s }: { id: string; x: number; y: number; s: number }) {
  const leaf = (angle: number, len: number, color: string) => (
    <path
      key={angle}
      d={`M0 0 C ${len * 0.25} ${-len * 0.25}, ${len * 0.35} ${-len * 0.8}, 0 ${-len} C ${-len * 0.35} ${-len * 0.8}, ${-len * 0.25} ${-len * 0.25}, 0 0Z`}
      fill={color}
      transform={`rotate(${angle})`}
    />
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g transform="translate(0 -30)">
        {leaf(-58, 70, "#6e2f59")}
        {leaf(-30, 88, "#86416b")}
        {leaf(0, 98, "#a2577b")}
        {leaf(28, 86, "#7a3862")}
        {leaf(55, 66, "#93506f")}
      </g>
      <path d="M-22 -32 H22 L16 4 H-16 Z" fill={`url(#${id}-roseBody)`} />
      <ellipse cx="0" cy="-32" rx="22" ry="5" fill={TOPS.rose} />
    </g>
  );
}

/* Name ------------------------------------------------------------------- */

/** The product name as plain type. No logo mark, by design. */
export function Wordmark({ className }: ArtProps) {
  return (
    <span className={["fp-wordmark", className].filter(Boolean).join(" ")}>
      Fils<span>Pay</span>
    </span>
  );
}

/** A small coin, used where a single object marks a place (card preview). */
export function Coin({ className, title, size = 40 }: ArtProps & { size?: number }) {
  const id = useSvgId();
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" {...a11y(title)}>
      <Defs id={id} />
      <CoinFace id={id} cx={19} cy={20} r={17} />
    </svg>
  );
}

/** Soft glowing orbs: the sidebar's quiet decoration. */
export function Orbs({ className }: ArtProps) {
  return (
    <div className={["fp-orbs", className].filter(Boolean).join(" ")} aria-hidden>
      <span className="fp-orb fp-orb-rose" />
      <span className="fp-orb fp-orb-apricot" />
      <span className="fp-orb fp-orb-sand" />
    </div>
  );
}

/* The dusk stage --------------------------------------------------------- */

/**
 * A plum-to-rose room at dusk with sculptures on pedestals: the scene behind
 * sign-in and checkout. Layers drift slightly with the pointer (depth via
 * CSS variables) and the floating coin bobs inside its ring. All motion stops
 * under prefers-reduced-motion.
 */
export function StageScene({ className, children }: { className?: string; children?: ReactNode }) {
  const id = useSvgId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--px", x.toFixed(3));
        el.style.setProperty("--py", y.toFixed(3));
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={["fp-stage", className].filter(Boolean).join(" ")}>
      <svg className="fp-stage-art" viewBox="0 0 600 420" preserveAspectRatio="xMidYMax meet" aria-hidden focusable={false}>
        <Defs id={id} />
        <defs>
          <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c86a74" />
            <stop offset="100%" stopColor="#e3948a" />
          </linearGradient>
          <radialGradient id={`${id}-sun`}>
            <stop offset="0%" stopColor="#ffe2c8" stopOpacity="0.95" />
            <stop offset="45%" stopColor={C.apricot} stopOpacity="0.55" />
            <stop offset="100%" stopColor={C.apricot} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-arch`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3e1b36" />
            <stop offset="100%" stopColor="#8c4566" />
          </linearGradient>
        </defs>

        {/* back wall: an arched alcove with the low sun inside it */}
        <g className="fp-depth fp-depth-1">
          <path d="M330 330 V170 a95 95 0 0 1 190 0 V330 Z" fill={`url(#${id}-arch)`} opacity="0.85" />
          <circle cx="425" cy="230" r="80" fill={`url(#${id}-sun)`} />
        </g>
        {/* the floor runs past the frame so wide panels never show an edge */}
        <path d="M-900 330 H1500 V420 H-900 Z" fill={`url(#${id}-floor)`} />
        <path d="M-900 330 H1500" stroke="#f2b4ad" strokeWidth="2" opacity="0.6" />

        <g className="fp-depth fp-depth-2">
          <Palm id={id} x={528} y={366} s={1} />
          <Pedestal id={id} cx={110} y={286} r={50} h={74} body="sand" />
          <Ball id={id} cx={110} cy={250} r={34} tone="rose" />
        </g>
        <g className="fp-depth fp-depth-3">
          <Pedestal id={id} cx={300} y={232} r={66} h={140} body="plum" />
          <CoinStack id={id} cx={300} y={236} r={44} count={4} />
          <g className="fp-float">
            <GlowRing id={id} cx={300} cy={140} rx={72} ry={20} />
            <CoinFace id={id} cx={300} cy={140} r={40} />
          </g>
        </g>
        <g className="fp-depth fp-depth-4">
          <Pedestal id={id} cx={440} y={318} r={40} h={50} body="rose" />
          <Ball id={id} cx={440} cy={296} r={22} tone="apricot" />
        </g>
      </svg>
      {children ? <div className="fp-stage-content">{children}</div> : null}
    </div>
  );
}

/* Spot scenes ------------------------------------------------------------ */

export type SceneName = "empty" | "lost" | "locked" | "storm" | "expired" | "success" | "waiting";

/** Small 3D still lifes for empty, error and outcome states. */
export function Scene({ name, className }: { name: SceneName; className?: string }) {
  const id = useSvgId();
  const cls = ["fp-scene", `fp-scene-${name}`, className].filter(Boolean).join(" ");
  const floor = <ellipse cx="100" cy="128" rx="90" ry="10" fill="#f3e6e3" />;

  switch (name) {
    case "empty":
      // An empty pedestal under a warm spotlight: nothing here yet.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          <path d="M80 0 H120 L150 124 H50 Z" fill={C.apricot} opacity="0.18" />
          {floor}
          <Pedestal id={id} cx={100} y={76} r={34} h={46} body="plum" />
        </svg>
      );
    case "lost":
      // The coin rolled off its pedestal: page not found.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          {floor}
          <Pedestal id={id} cx={70} y={70} r={34} h={52} body="rose" />
          <path d="M112 112 q10 -4 18 0 M118 102 q8 -3 14 0" stroke="#d8bcc6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <g transform="rotate(24 160 106)">
            <CoinFace id={id} cx={160} cy={106} r={18} />
          </g>
          <text x="58" y="50" fontSize="26" fontWeight="700" fill={C.plum} opacity="0.35" fontFamily="Readex Pro, system-ui">?</text>
        </svg>
      );
    case "locked":
      // The coin under a glass dome, with a padlock: not permitted.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          {floor}
          <Pedestal id={id} cx={100} y={88} r={44} h={34} body="plum" />
          <CoinFace id={id} cx={100} cy={64} r={20} />
          <path d="M62 88 V60 a38 38 0 0 1 76 0 V88" fill="#ffffff" fillOpacity="0.3" stroke="#e6cfd9" strokeWidth="2" />
          <path d="M74 44 a28 28 0 0 1 16 -12" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.7" fill="none" />
          <rect x="128" y="96" width="26" height="22" rx="5" fill={C.rose} />
          <path d="M133 96 v-6 a8 8 0 0 1 16 0 v6" stroke={C.rose} strokeWidth="4" fill="none" />
        </svg>
      );
    case "storm":
      // A toppled pedestal, coins scattered: something failed.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          {floor}
          <g transform="rotate(-62 82 104)">
            <Pedestal id={id} cx={82} y={70} r={26} h={52} body="plum" />
          </g>
          <g transform="rotate(-20 140 116)">
            <CoinFace id={id} cx={140} cy={116} r={11} />
          </g>
          <g transform="rotate(30 166 110)">
            <CoinFace id={id} cx={166} cy={110} r={8} />
          </g>
          <path d="M150 12 l-14 30 h12 l-8 24 24 -34 h-12 l8 -20 Z" fill={C.sand} stroke={C.sandDeep} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "expired":
      // An hourglass on a pedestal, sand run out: expired.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          {floor}
          <Pedestal id={id} cx={100} y={100} r={38} h={22} body="sand" />
          <rect x="76" y="20" width="48" height="6" rx="3" fill={C.plum} />
          <rect x="76" y="92" width="48" height="6" rx="3" fill={C.plum} />
          <path d="M82 26 C82 50 118 50 118 26 Z M82 92 C82 66 118 66 118 92 Z" fill="#ffffff" fillOpacity="0.55" stroke="#dcc2cd" strokeWidth="2" />
          <path d="M88 92 C90 80 110 80 112 92 Z" fill={C.rose} />
          <path d="M82 26 C82 50 118 50 118 26 M82 92 C82 66 118 66 118 92" fill="none" stroke="#c9a6b8" strokeWidth="2" />
        </svg>
      );
    case "success":
      // The coin rises in its glowing ring: paid.
      return (
        <svg className={cls} viewBox="0 0 200 140" aria-hidden focusable={false}>
          <Defs id={id} />
          {floor}
          <Pedestal id={id} cx={100} y={102} r={40} h={20} body="plum" />
          <g className="fp-scene-rise">
            <GlowRing id={id} cx={100} cy={58} rx={52} ry={14} />
            <CoinFace id={id} cx={100} cy={58} r={30} />
            <path d="M88 58 l8 8 16 -16" stroke="#7a5212" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      );
    case "waiting":
      // Three spheres bouncing in turn: loading.
      return (
        <svg className={cls} viewBox="0 0 120 40" aria-hidden focusable={false}>
          <Defs id={id} />
          {(["rose", "apricot", "plum"] as const).map((tone, i) => (
            <g key={tone} className={`fp-wait-dot fp-wait-dot-${i}`}>
              <Ball id={id} cx={30 + i * 30} cy={20} r={9} tone={tone} />
            </g>
          ))}
        </svg>
      );
  }
}
