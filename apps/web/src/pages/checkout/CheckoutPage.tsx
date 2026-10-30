import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import { Scene, Wordmark, type SceneName } from "../../components/art/Art.js";
import { icons } from "../../components/art/Icons.js";
import { DesignArt } from "../../components/art/DesignArt.js";
import { useCountUp } from "../../components/kit/CountUp.js";
import { Amount, Loading, StatePanel, usePageTitle } from "../../components/ui.js";
import { describePayFailure } from "./payError.js";
import "./CheckoutPage.css";

type LoadState =
  | { kind: "loading" }
  /** The API is full (503 overloaded): waiting to try again. */
  | { kind: "busy" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: string; retryable: boolean }
  | { kind: "terminal"; message: string };

const EMPTY_CARD: SimulatedCardInput = { pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [card, setCard] = useState<SimulatedCardInput>(EMPTY_CARD);
  const [brandHint, setBrandHint] = useState<string | null>(null);
  const [cvvFocused, setCvvFocused] = useState(false);
  const [declines, setDeclines] = useState(0);

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number): void => {
      getPaymentLink(token)
        .then((link) => {
          if (!cancelled) setLoadState({ kind: "loaded", link });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // A busy API turns requests away with 503 (plugins/overloadGuard.ts
          // on the API): wait and try again rather than calling the link
          // missing. 1, 2, 4, then every 5 seconds.
          if (err instanceof ApiError && err.statusCode === 503) {
            setLoadState({ kind: "busy" });
            timer = setTimeout(() => load(attempt + 1), Math.min(5000, 1000 * 2 ** attempt));
            return;
          }
          // Never distinguishes "malformed token" from "doesn't exist" —
          // matches the API's own non-disclosure choice.
          setLoadState({ kind: "not_found" });
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;

    // A fresh Idempotency-Key per explicit user action — every click,
    // including a "try again" after a decline, is a new attempt.
    const idempotencyKey = crypto.randomUUID();
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(token, { card }, idempotencyKey);
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const failure = describePayFailure(err.statusCode, err.body);
        setPayState(
          failure.kind === "terminal"
            ? { kind: "terminal", message: failure.message }
            : { kind: "declined", message: failure.message, retryable: true },
        );
        if (failure.countsAsDecline) setDeclines((n) => n + 1);
      } else {
        setPayState({ kind: "declined", message: "Can't reach FilsPay. Check your connection and try again.", retryable: true });
      }
    }
  }

  const pageTitle =
    loadState.kind === "loaded" ? `Pay ${loadState.link.merchantDisplayName}` : loadState.kind === "not_found" ? "Payment link not found" : "Checkout";
  usePageTitle(payState.kind === "success" ? "Payment received" : pageTitle);

  if (loadState.kind === "loading" || loadState.kind === "busy") {
    return (
      <CheckoutFrame>
        <Loading label={loadState.kind === "busy" ? "We're very busy. Opening your payment in a moment" : "Opening your payment"} />
      </CheckoutFrame>
    );
  }

  if (loadState.kind === "not_found") {
    return (
      <CheckoutOutcome scene="lost" title="We couldn't find this payment link">
        Check the link you were sent, or ask the business for a new one.
      </CheckoutOutcome>
    );
  }

  const { link } = loadState;

  if (payState.kind === "success") {
    return (
      <CheckoutOutcome
        scene="success"
        title={`Paid to ${link.merchantDisplayName}`}
        tone="success"
        actions={
          <button type="button" className="checkout-print" onClick={() => window.print()}>
            Print receipt
          </button>
        }
      >
        <p className="checkout-paid-amount">
          <RollingAmount fils={payState.result.amountFils ?? link.amountFils} />
        </p>
        <dl className="checkout-receipt">
          <dt>Paid at</dt>
          <dd>{new Date(payState.result.paidAt).toLocaleString()}</dd>
          <dt>Transaction</dt>
          <dd>
            <code>{payState.result.transactionId}</code>
          </dd>
          {link.reference ? (
            <>
              <dt>Reference</dt>
              <dd>{link.reference}</dd>
            </>
          ) : null}
        </dl>
        <p className="checkout-note">Keep this page or the transaction number as your receipt.</p>
      </CheckoutOutcome>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <CheckoutOutcome scene="locked" title="This link can't take a payment">
        {payState.message}
      </CheckoutOutcome>
    );
  }

  if (link.status === "paid") {
    return (
      <CheckoutOutcome scene="success" title="Already paid">
        This invoice from {link.merchantDisplayName} has already been paid. Nothing more is due.
      </CheckoutOutcome>
    );
  }
  if (link.status === "expired") {
    return (
      <CheckoutOutcome scene="expired" title="This payment link has expired">
        Ask {link.merchantDisplayName} to send you a new link.
      </CheckoutOutcome>
    );
  }
  if (link.status === "canceled") {
    return (
      <CheckoutOutcome scene="locked" title="This payment link was cancelled">
        {link.merchantDisplayName} cancelled this link. Contact them if you still need to pay.
      </CheckoutOutcome>
    );
  }
  if (link.status === "unavailable") {
    return (
      <CheckoutOutcome scene="locked" title="This link can't take payments right now">
        {link.merchantDisplayName} can't accept payments at the moment. No payment was taken. Contact them to pay
        another way.
      </CheckoutOutcome>
    );
  }
  if (link.status === "processing") {
    return (
      <CheckoutOutcome scene="waiting" title="A payment is in progress">
        Someone is paying this link right now. Wait a moment, then refresh this page.
      </CheckoutOutcome>
    );
  }

  // link.status === 'active'
  const amount = formatBhd(toFils(link.amountFils));
  const submitting = payState.kind === "submitting";

  return (
    <CheckoutFrame
      summary={
        <div className="checkout-summary">
          {/* The page's one h1: what this page is for. Styled as before. */}
          <h1 className="checkout-payee">
            <span className="checkout-payee-mark" aria-hidden>
              {link.merchantDisplayName.trim().charAt(0).toUpperCase()}
            </span>
            Pay {link.merchantDisplayName}
          </h1>
          <p className="checkout-amount">
            <Amount fils={link.amountFils} />
          </p>
          <dl className="checkout-lines">
            {link.description ? (
              <>
                <dt>For</dt>
                <dd>{link.description}</dd>
              </>
            ) : null}
            {link.reference ? (
              <>
                <dt>Reference</dt>
                <dd>{link.reference}</dd>
              </>
            ) : null}
            <dt>Link valid until</dt>
            <dd>{new Date(link.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
            <dt className="checkout-total">Total due</dt>
            <dd className="checkout-total">
              <Amount fils={link.amountFils} />
            </dd>
          </dl>
        </div>
      }
    >
      <CardPreview card={card} brand={brandHint} flipped={cvvFocused} shake={declines} />

      {payState.kind === "declined" ? (
        <p className="checkout-error" role="alert">
          {payState.message}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="checkout-form">
        <label>
          Card number
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 5678 9012 3456"
            required
            value={card.pan}
            onChange={(e) => {
              const pan = e.target.value;
              setCard({ ...card, pan });
              const digits = pan.replace(/\D/g, "");
              if (digits.length >= 1) {
                void import("../../utils/helpers.js").then((m) => {
                  setBrandHint(m.formatCardBrandHint(digits));
                });
              } else {
                setBrandHint(null);
              }
            }}
          />
        </label>
        <div className="checkout-form-row">
          <label>
            Month
            <input
              type="number"
              inputMode="numeric"
              autoComplete="cc-exp-month"
              min={1}
              max={12}
              required
              value={card.expiryMonth}
              onChange={(e) => setCard({ ...card, expiryMonth: Number(e.target.value) })}
            />
          </label>
          <label>
            Year
            <input
              type="number"
              inputMode="numeric"
              autoComplete="cc-exp-year"
              min={new Date().getFullYear()}
              required
              value={card.expiryYear}
              onChange={(e) => setCard({ ...card, expiryYear: Number(e.target.value) })}
            />
          </label>
          <label>
            CVV
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              maxLength={4}
              required
              value={card.cvv}
              onFocus={() => setCvvFocused(true)}
              onBlur={() => setCvvFocused(false)}
              onChange={(e) => setCard({ ...card, cvv: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Scene name="waiting" />
              Processing payment
            </>
          ) : (
            <>
              {icons.lock}
              Pay {amount} BHD
            </>
          )}
        </button>
      </form>

      <p className="checkout-secure">
        Secured by FilsPay. Your card details go straight to the card network and are never shared with{" "}
        {link.merchantDisplayName}.
      </p>

      <details className="checkout-help">
        <summary>Testing? Use the simulated cards</summary>
        <p>
          No real charge is made. Any number approves, except numbers ending <code>0002</code> (declined),{" "}
          <code>0119</code> (insufficient funds) and <code>0069</code> (card network error).
        </p>
      </details>
    </CheckoutFrame>
  );
}

/** Page frame: the order summary on one side, the payment form on the
 *  other; stacked on phones. */
function CheckoutFrame({ summary, children }: { summary?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="checkout-page">
      <aside className="checkout-sea" aria-label="Order summary">
        <div className="checkout-brandbar">
          <Wordmark />
          <span className="checkout-secure-tag">
            {icons.lock}
            Secure checkout
          </span>
        </div>
        {summary}
        <DesignArt className="checkout-art" />
      </aside>
      <main className="checkout-panel">{children}</main>
    </div>
  );
}

function CheckoutOutcome({
  scene,
  title,
  children,
  tone,
  actions,
}: {
  scene: SceneName;
  title: string;
  children: React.ReactNode;
  tone?: "success";
  actions?: React.ReactNode;
}) {
  return (
    <div className={`checkout-outcome${tone === "success" ? " checkout-outcome-success" : ""}`}>
      <div className="checkout-outcome-card">
        <StatePanel scene={scene} title={title} actions={actions}>
          {typeof children === "string" ? <p>{children}</p> : children}
        </StatePanel>
      </div>
      <p className="checkout-footer">
        {icons.lock}
        Payments by FilsPay
      </p>
    </div>
  );
}

/** The paid amount rolls up from zero. */
function RollingAmount({ fils }: { fils: number }) {
  const value = useCountUp(fils, 1400);
  return <Amount fils={value} />;
}

/** A live card that fills in as the buyer types and tilts toward the
 *  pointer. It turns over to show the back while the CVV field has focus,
 *  and shakes when a payment is declined. Shows the last four digits only. */
function CardPreview({ card, brand, flipped, shake }: { card: SimulatedCardInput; brand: string | null; flipped: boolean; shake: number }) {
  const digits = card.pan.replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "\u2022");
  const groups = digits.length > 4 ? "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 " + last4 : "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 " + (digits || "\u2022\u2022\u2022\u2022").padEnd(4, "\u2022");
  const month = String(card.expiryMonth || "").padStart(2, "0");
  const year = String(card.expiryYear || "").slice(-2);
  const brandLabel = brand && brand !== "unknown" ? brand : null;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  return (
    <div
      className="checkout-card3d"
      aria-hidden
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const box = e.currentTarget.getBoundingClientRect();
        setTilt({ x: ((e.clientX - box.left) / box.width - 0.5) * 2, y: ((e.clientY - box.top) / box.height - 0.5) * 2 });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div key={shake} className={`checkout-card-shaker${shake ? " is-shaking" : ""}`}>
        <div
          className="checkout-card-inner"
          data-flipped={flipped}
          style={{ "--tx": tilt.x.toFixed(3), "--ty": tilt.y.toFixed(3) } as React.CSSProperties}
        >
          <div className="checkout-card checkout-card-front" data-brand={brandLabel ?? "none"}>
            <div className="checkout-card-top">
              <CardChip />
              <span className="checkout-card-brand">{brandLabel ?? "Card"}</span>
            </div>
            <div className="checkout-card-number">{groups}</div>
            <div className="checkout-card-bottom">
              <span>
                Valid thru {month}/{year}
              </span>
              <span>{digits.length ? `${digits.length} digits` : "Your card"}</span>
            </div>
          </div>
          <div className="checkout-card checkout-card-back">
            <span className="checkout-card-stripe" />
            <div className="checkout-card-sign">
              <span className="checkout-card-cvv">{card.cvv ? "\u2022".repeat(Math.min(card.cvv.length, 4)) : "CVV"}</span>
            </div>
            <span className="checkout-card-backnote">The 3 or 4 digits on the back of your card</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The card's contact chip. */
function CardChip() {
  return (
    <svg className="checkout-card-chip" viewBox="0 0 40 30" aria-hidden focusable={false}>
      <rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="#e3c891" stroke="#b89a5a" />
      <path d="M0 10h12M0 20h12M28 10h12M28 20h12M12 0v30M28 0v30M12 15h16" stroke="#b89a5a" strokeWidth="1" fill="none" />
    </svg>
  );
}
