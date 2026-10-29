import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, resendOtp, verifyOtp } from "../../api/dashboardAuth.js";
import { ApiError, describeError } from "../../api/client.js";
import {
  readLastMerchantId,
  useDashboardAuth,
  writeLastMerchantId,
} from "../../auth/DashboardAuthContext.js";
import type { DashboardLoginResponse } from "../../types.js";
import { SeaScene, Wordmark } from "../../components/art/Art.js";
import { ErrorBanner, usePageTitle } from "../../components/ui.js";

type Step = { kind: "credentials" } | { kind: "otp"; challenge: DashboardLoginResponse };

/**
 * Two-step merchant login: merchantId + email + password
 * creates a *pending* session and issues an OTP challenge; the OTP step is
 * what actually authenticates it. Neither step is told which credential was
 * wrong — the API answers a single generic `invalid_credentials`, and this
 * screen repeats it verbatim rather than guessing at something more specific.
 *
 * The Merchant ID field is a raw pasted UUID. This is a genuine rough edge,
 * not a preference: `merchant_users.email` is unique per merchant rather than
 * globally (Phase 1 schema), so an email alone cannot identify a user, and no
 * merchant slug or subdomain concept exists anywhere in the platform to infer
 * the id from. `localStorage` remembering the last-used value is the whole
 * mitigation available without new backend work; a lookup-by-email endpoint
 * or a per-merchant subdomain would be the real fix, and both are out of
 * scope for a frontend-only phase.
 */
export function LoginPage() {
  const { status, refresh } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  // MK: remembers the last merchantId in localStorage. not a secret
  const [merchantId, setMerchantId] = useState(() => readLastMerchantId());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard/transactions";
  usePageTitle(step.kind === "otp" ? "Enter your code" : "Sign in");

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  function backToCredentials(message: string | null): void {
    setStep({ kind: "credentials" });
    setCode("");
    setError(message);
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await login({ merchantId: merchantId.trim(), email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // after otp we get logged out after ~10 min. cookie ttl never extended? — am
  // MK: that's the idle timeout, by design
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await verifyOtp({ code });
      writeLastMerchantId(merchantId.trim());
      // The session cookie is now authenticated server-side; re-read `me` so
      // the rest of the dashboard renders from the server's answer, not from
      // the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // `429 too_many_attempts` revokes the pending session server-side, so
      // retrying the OTP step against it can only ever fail again — start
      // over instead of leaving the user tapping a dead form.
      if (err instanceof ApiError && err.statusCode === 429 && err.code === "too_many_attempts") {
        backToCredentials(describeError(err));
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await resendOtp();
      setStep({ kind: "otp", challenge });
      setCode("");
      setNotice("A new code has been sent.");
    } catch (err) {
      // Includes `429 resend_too_soon` — the server owns the cadence rule, so
      // whatever it says is shown as-is rather than pre-empted by a
      // client-side timer that could drift from it.
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dash-login">
      <SeaScene className="dash-login-sea">
        <Wordmark />
        <div className="dash-login-pitch">
          <h2>Every fils, accounted for.</h2>
          <p>Card payments, payment links and daily settlement for merchants across Bahrain.</p>
        </div>
      </SeaScene>

      <main className="dash-login-panel">
        <div className="dash-centered">
          <ol className="dash-login-steps" aria-label={step.kind === "otp" ? "Step 2 of 2" : "Step 1 of 2"}>
            <li data-done="true" />
            <li data-done={step.kind === "otp"} />
          </ol>

          {step.kind === "credentials" ? (
            <>
              <h1>Sign in to your dashboard</h1>
              <p className="dash-muted">Use the merchant ID from your welcome email or API settings.</p>
            </>
          ) : (
            <>
              <h1>Enter your code</h1>
              <p className="dash-muted">
                We sent a 6-digit code for <strong>{email}</strong>. It works until{" "}
                {new Date(step.challenge.otpExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              </p>
            </>
          )}

          {error ? <ErrorBanner message={error} /> : null}
          {notice ? (
            <p className="dash-notice" role="status">
              {notice}
            </p>
          ) : null}

          {step.kind === "credentials" ? (
            <form onSubmit={(e) => void handleCredentials(e)} className="dash-form">
              <label>
                Merchant ID
                <input
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button type="submit" className="dash-button" disabled={submitting}>
                {submitting ? "Checking your details" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void handleOtp(e)} className="dash-form">
              {step.challenge.devOtpCode ? (
                <div className="dash-otp-dev">
                  <span>Development code</span>
                  <strong>{step.challenge.devOtpCode}</strong>
                  <button
                    type="button"
                    className="dash-link-button"
                    onClick={() => setCode(step.challenge.devOtpCode ?? "")}
                  >
                    Use it
                  </button>
                </div>
              ) : null}
              <label>
                One-time code
                <input
                  className="dash-otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]*"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <button type="submit" className="dash-button" disabled={submitting || code.length === 0}>
                {submitting ? "Verifying" : "Verify and sign in"}
              </button>
              <div className="dash-login-secondary">
                <button
                  type="button"
                  className="dash-link-button"
                  disabled={submitting}
                  onClick={() => void handleResend()}
                >
                  Send a new code
                </button>
                <button type="button" className="dash-link-button" onClick={() => backToCredentials(null)}>
                  Use different details
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
