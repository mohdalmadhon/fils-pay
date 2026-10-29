/** Small shared pieces of the FilsPay interface: page titles, amounts,
 *  loading/empty/error states, and the full-page state panel used by the
 *  error and outcome pages. */
import { useEffect, type ReactNode } from "react";
import { formatBhd, toFils } from "@filspay/money";
import { Scene, type SceneName } from "./art/Art.js";

/** Sets the browser tab title: "Transactions · FilsPay". */
export function usePageTitle(title: string | null | undefined, app = "FilsPay"): void {
  useEffect(() => {
    document.title = title ? `${title} | ${app}` : app;
  }, [title, app]);
}

/** A BHD amount with the whole dinars at full weight and the three fils
 *  digits lighter, so 4.750 reads as "4 dinars, 750 fils". */
export function Amount({ fils, className, currency = true }: { fils: number; className?: string; currency?: boolean }) {
  const text = formatBhd(toFils(fils, { allowNegative: true }));
  const [bd, fl] = text.split(".");
  return (
    <span className={["fp-amount", className].filter(Boolean).join(" ")} aria-label={`${text} BHD`}>
      <span className="fp-amount-bd" aria-hidden>
        {bd}
      </span>
      <span className="fp-amount-fils" aria-hidden>
        .{fl}
      </span>
      {currency ? (
        <span className="fp-amount-cur" aria-hidden>
          BHD
        </span>
      ) : null}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="fp-loading" role="status" aria-live="polite">
      <Scene name="waiting" />
      <span>{label}</span>
    </div>
  );
}

/** Inline error, announced to screen readers. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="dash-error" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="dash-button dash-button-quiet" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Empty list or table body: what is missing and what to do about it. */
export function EmptyState({ title, children, scene = "empty" }: { title: string; children?: ReactNode; scene?: SceneName }) {
  return (
    <div className="fp-empty">
      <Scene name={scene} />
      <p className="fp-empty-title">{title}</p>
      {children ? <div className="fp-empty-body">{children}</div> : null}
    </div>
  );
}

/** A whole-page state: not found, not permitted, failed, paid, expired. */
export function StatePanel({
  scene,
  title,
  children,
  actions,
  code,
}: {
  scene: SceneName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  code?: string;
}) {
  return (
    <section className="fp-state">
      <Scene name={scene} className="fp-state-art" />
      {code ? <p className="fp-state-code">{code}</p> : null}
      <h1>{title}</h1>
      {children ? <div className="fp-state-body">{children}</div> : null}
      {actions ? <div className="fp-state-actions">{actions}</div> : null}
    </section>
  );
}
