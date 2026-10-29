/**
 * The dusk panel used on sign-in and checkout: a low sun over rose dunes,
 * and a live pile of coins along the bottom that visitors can flick. A hint
 * chip counts the flicks.
 */
import { forwardRef, useState, type ReactNode } from "react";
import { CoinPhysics, type CoinPhysicsHandle } from "./CoinPhysics.js";

interface Props {
  className?: string;
  children?: ReactNode;
  /** Coins dropped in when the panel appears. */
  initial?: number;
  /** Replaces the default "flick the coins" hint. */
  hint?: ReactNode;
}

export const CoinPit = forwardRef<CoinPhysicsHandle, Props>(function CoinPit({ className, children, initial = 26, hint }, ref) {
  const [flicks, setFlicks] = useState(0);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <div className={["fp-pit", className].filter(Boolean).join(" ")}>
      <span className="fp-pit-sun" aria-hidden />
      <svg className="fp-pit-dunes" viewBox="0 0 600 140" preserveAspectRatio="none" aria-hidden focusable={false}>
        <path d="M0 70 C 120 30 220 40 330 72 S 520 40 600 58 V140 H0 Z" fill="#b65a72" opacity="0.55" />
        <path d="M0 100 C 140 70 260 82 380 104 S 540 86 600 96 V140 H0 Z" fill="#d9777f" opacity="0.7" />
      </svg>
      <CoinPhysics ref={ref} initial={initial} interactive onFlick={setFlicks} />
      {children ? <div className="fp-pit-content">{children}</div> : null}
      <p key={flicks} className="fp-pit-hint" data-bump={flicks > 0} aria-hidden>
        {hint ??
          (flicks > 0 ? (
            <>
              You&apos;ve flicked <strong>{flicks} fils</strong>
            </>
          ) : touch ? (
            "Swipe the coins. Tap to drop one."
          ) : (
            "Flick the coins. Click to drop one."
          ))}
      </p>
    </div>
  );
});
