import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import { BrandMark, Pearl, SeaScene, type SceneName } from "../../components/art/Art.js";
import { Amount, Loading, StatePanel, usePageTitle } from "../../components/ui.js";
import "./CheckoutPage.css";

type LoadState =
  | { kind: "loading" }
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

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    getPaymentLink(token)
      .then((link) => {
        if (!cancelled) setLoadState({ kind: "loaded", link });
      })
      .catch(() => {
        // Never distinguishes "malformed token" from "doesn't exist" —
        // matches the API's own non-disclosure choice.
        if (!cancelled) setLoadState({ kind: "not_found" });
      });
    return () => {
      cancelled = true;
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
        const { statusCode, body } = err;
        if (statusCode === 402) {
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The acquirer is temporarily unavailable. Please try again.", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This invoice has already been paid." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This payment link is no longer available." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please try again shortly.", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This payment link has expired." });
        } else {
          setPayState({ kind: "declined", message: body.message ?? "Something went wrong. Please try again.", retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "Something went wrong. Please try again.", retryable: true });
      }
    }
  }

  const pageTitle =
    loadState.kind === "loaded" ? `Pay ${loadState.link.merchantDisplayName}` : loadState.kind === "not_found" ? "Payment link not found" : "Checkout";
  usePageTitle(payState.kind === "success" ? "Payment received" : pageTitle);

  if (loadState.kind === "loading") {
    return (
      <CheckoutFrame>
        <Loading label="Opening your payment" />
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
      <CheckoutOutcome scene="success" title={`Paid to ${link.merchantDisplayName}`} tone="success">
        <p className="checkout-paid-amount">
          <Amount fils={payState.result.amountFils ?? link.amountFils} />
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
      <CheckoutOutcome scene="lowtide" title="This payment link has expired">
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
          <p className="checkout-payee">
            <BrandMark size={28} />
            {link.merchantDisplayName}
          </p>
          <p className="checkout-amount">
            <Amount fils={link.amountFils} />
          </p>
          {link.description ? <p className="checkout-description">{link.description}</p> : null}
          {link.reference ? <p className="checkout-reference">Reference {link.reference}</p> : null}
          <p className="checkout-expiry">
            Link valid until {new Date(link.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
      }
    >
      <CardPreview card={card} brand={brandHint} />

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
              onChange={(e) => setCard({ ...card, cvv: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Processing payment" : `Pay ${amount} BHD`}
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

/** Page frame: the sea panel with the amount on one side, the form on the
 *  other; stacked on phones. */
function CheckoutFrame({ summary, children }: { summary?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="checkout-page">
      <SeaScene className="checkout-sea">{summary}</SeaScene>
      <main className="checkout-panel">{children}</main>
    </div>
  );
}

function CheckoutOutcome({
  scene,
  title,
  children,
  tone,
}: {
  scene: SceneName;
  title: string;
  children: React.ReactNode;
  tone?: "success";
}) {
  return (
    <div className={`checkout-outcome${tone === "success" ? " checkout-outcome-success" : ""}`}>
      <StatePanel scene={scene} title={title}>
        {typeof children === "string" ? <p>{children}</p> : children}
      </StatePanel>
      <p className="checkout-footer">
        <BrandMark size={20} /> Payments by FilsPay
      </p>
    </div>
  );
}

/** A live card that fills in as the buyer types. Shows the last four digits
 *  only, never the full number. */
function CardPreview({ card, brand }: { card: SimulatedCardInput; brand: string | null }) {
  const digits = card.pan.replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "\u2022");
  const groups = digits.length > 4 ? "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 " + last4 : "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 " + (digits || "\u2022\u2022\u2022\u2022").padEnd(4, "\u2022");
  const month = String(card.expiryMonth || "").padStart(2, "0");
  const year = String(card.expiryYear || "").slice(-2);
  const brandLabel = brand && brand !== "unknown" ? brand : null;
  return (
    <div className="checkout-card" data-brand={brandLabel ?? "none"} aria-hidden>
      <div className="checkout-card-top">
        <Pearl size={30} />
        <span className="checkout-card-brand">{brandLabel ?? "Card"}</span>
      </div>
      <div className="checkout-card-number">{groups}</div>
      <div className="checkout-card-bottom">
        <span>
          Valid thru {month}/{year}
        </span>
        <span>CVV {card.cvv ? "\u2022".repeat(Math.min(card.cvv.length, 4)) : "\u2022\u2022\u2022"}</span>
      </div>
    </div>
  );
}
