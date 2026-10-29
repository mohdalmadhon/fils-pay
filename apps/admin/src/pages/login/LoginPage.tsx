import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/auth.js";
import { describeError } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import type { AdminLoginResponse } from "../../types.js";
import { StageScene, Wordmark } from "../../components/art/Art.js";
import { ErrorBanner, usePageTitle } from "../../components/ui.js";

type Step =
  | { kind: "credentials" }
  | { kind: "otp"; challenge: AdminLoginResponse };

/**
 * Two-step admin login: email + password creates a *pending* session
 * and issues an OTP challenge; the OTP step is what actually authenticates
 * it. Neither step is told which half of a bad credential pair was wrong:
 * the API answers a single generic `invalid_credentials`.
 */
export function LoginPage() {
  const { status, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(step.kind === "otp" ? "Enter your code" : "Sign in");

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/merchants";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // YA: admin verify re-issues the cookie with the full TTL
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      // The session cookie is now authenticated server-side; re-read `me`
      // so the rest of the console renders from the server's answer, not
      // from the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login">
      <StageScene className="admin-login-sea">
        <Wordmark />
        <div className="admin-login-pitch">
          <h2>Every merchant, every batch, in one place.</h2>
          <p>Operations console for FilsPay staff: merchants, credits, settlement and webhooks.</p>
        </div>
      </StageScene>

      <main className="admin-login-panel">
        <div className="admin-centered">
          {step.kind === "credentials" ? (
            <>
              <h1>Staff sign-in</h1>
              <p className="admin-muted">Every action in this console is recorded in the audit log.</p>
            </>
          ) : (
            <>
              <h1>Enter your code</h1>
              <p className="admin-muted">
                A 6-digit code was issued for <strong>{email}</strong>. It works until{" "}
                {new Date(step.challenge.otpExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              </p>
            </>
          )}

          {error ? <ErrorBanner message={error} /> : null}

          {step.kind === "credentials" ? (
            <form onSubmit={(e) => void handleCredentials(e)} className="admin-form">
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
              <button type="submit" disabled={submitting}>
                {submitting ? "Checking your details" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void handleOtp(e)} className="admin-form">
              {step.challenge.devOtpCode ? (
                <div className="admin-otp-dev">
                  <span>Development code</span>
                  <strong>{step.challenge.devOtpCode}</strong>
                  <button
                    type="button"
                    className="admin-link-button"
                    onClick={() => setCode(step.challenge.devOtpCode ?? "")}
                  >
                    Use it
                  </button>
                </div>
              ) : null}
              <label>
                One-time code
                <input
                  className="admin-otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <button type="submit" disabled={submitting || code.length === 0}>
                {submitting ? "Verifying" : "Verify and sign in"}
              </button>
              <button
                type="button"
                className="admin-link-button"
                onClick={() => {
                  setStep({ kind: "credentials" });
                  setCode("");
                  setError(null);
                }}
              >
                Use different details
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
