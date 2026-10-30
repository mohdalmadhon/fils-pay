import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeCard, type Box, type CardPlacement } from "./placeCard.js";
import { nextTourIndex, tourProgress, type TourAction, type TourStep } from "./tourSteps.js";

interface TourProps {
  steps: readonly TourStep[];
  /** "done" after the last step, "skipped" when the person leaves early. */
  onClose: (how: "done" | "skipped") => void;
}

const PAD = 6;

function findTarget(step: TourStep | undefined): HTMLElement | null {
  if (!step?.target) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

function measure(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/**
 * The guided tour: dims the page, outlines one element at a time and shows
 * a card beside it with Back, Next (Finish on the last step) and Skip tour.
 * It is a modal dialog: focus moves into the card, Tab stays in it, Escape
 * skips, and focus goes back to whatever opened the tour when it closes.
 */
export function Tour({ steps, onClose }: TourProps) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const step = steps[index];
  const last = index === steps.length - 1;

  const act = useCallback(
    (action: TourAction) => {
      const next = nextTourIndex(index, steps.length, action);
      if (next === null) onClose(action === "skip" ? "skipped" : "done");
      else setIndex(next);
    },
    [index, steps.length, onClose],
  );

  // Point at the step's element: scroll it into view, then measure it and
  // place the card. Re-measured when the window scrolls or resizes.
  const layout = useCallback(() => {
    const target = findTarget(step);
    const box = measure(target);
    const card = cardRef.current;
    const size = card ? { width: card.offsetWidth, height: card.offsetHeight } : { width: 320, height: 200 };
    setSpot(box);
    setPlacement(placeCard(box, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [step]);

  useLayoutEffect(() => {
    findTarget(step)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    layout();
  }, [step, layout]);

  useEffect(() => {
    window.addEventListener("resize", layout);
    window.addEventListener("scroll", layout, true);
    return () => {
      window.removeEventListener("resize", layout);
      window.removeEventListener("scroll", layout, true);
    };
  }, [layout]);

  // Focus Next once the card is placed: until then it is hidden and can't
  // take focus.
  const placed = placement !== null;
  useEffect(() => {
    if (placed) primaryRef.current?.focus();
  }, [index, placed]);

  useEffect(() => {
    const opener = openerRef.current;
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      act("skip");
      return;
    }
    if (e.key === "ArrowRight") act("next");
    if (e.key === "ArrowLeft") act("back");
    if (e.key !== "Tab") return;
    const buttons = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length === 0) return;
    const first = buttons[0]!;
    const final = buttons[buttons.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      final.focus();
    } else if (!e.shiftKey && document.activeElement === final) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!step) return null;
  return (
    <div className="fp-tour" onKeyDown={onKeyDown}>
      {/* Dims everything but the outlined element; clicks on the page are
          held back while the tour is open. */}
      <div className="fp-tour-shade" data-spot={spot ? true : undefined} aria-hidden />
      {spot ? (
        <div
          className="fp-tour-spot"
          aria-hidden
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : null}
      <div
        ref={cardRef}
        className="fp-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fp-tour-title"
        aria-describedby="fp-tour-body"
        data-side={placement?.side ?? "center"}
        style={placement ? { top: placement.top, left: placement.left } : { visibility: "hidden" }}
      >
        <p className="fp-tour-progress">{tourProgress(index, steps.length)}</p>
        <h2 id="fp-tour-title" className="fp-tour-title">
          {step.title}
        </h2>
        <p id="fp-tour-body" className="fp-tour-body">
          {step.body}
        </p>
        <div className="fp-tour-dots" aria-hidden>
          {steps.map((s, i) => (
            <span key={s.id} data-on={i === index || undefined} />
          ))}
        </div>
        <div className="fp-tour-actions">
          <button type="button" className="fp-tour-skip" onClick={() => act("skip")}>
            Skip tour
          </button>
          <span className="fp-tour-nav">
            <button type="button" className="fp-tour-back" onClick={() => act("back")} disabled={index === 0}>
              Back
            </button>
            <button ref={primaryRef} type="button" className="fp-tour-next" onClick={() => act("next")}>
              {last ? "Finish" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
