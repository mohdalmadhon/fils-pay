import type { ApiErrorBody } from "../types.js";
import { reportApiFailure } from "./sessionEvents.js";

// `?.` so this module also loads outside Vite (unit tests), where
// import.meta.env is undefined.
const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

/** Mirrors apps/api's own uniform `{ error, message? }` body
 *  (lib/errors.ts / plugins/errorHandler.ts) — one error shape end to
 *  end, not reinvented client-side. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(statusCode: number, body: ApiErrorBody) {
    super(body.message ?? body.error);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = body.error;
    this.body = body;
  }
}

/**
 * `credentials: "include"`: the dashboard is cookie-authenticated
 * (`fp_sid`), and apps/web (5173) is not the API origin (3000), so the
 * session cookie only rides along on a request that asks for it. The public
 * checkout flow is unaffected — /pay/:token reads no cookie server-side, so
 * sending one that doesn't exist is a no-op there.
 *
 * `Content-Type: application/json` is sent only when there actually is a
 * body: logout, void and replay take none, and Fastify rejects a request
 * that declares a JSON content type while carrying an empty body
 * (`FST_ERR_CTP_EMPTY_JSON_BODY`). Same fix apps/admin's client.ts already
 * carries, for the same reason.
 */
// Cross-origin with credentials: the API must list this app's origin in
// CORS_ALLOWED_ORIGINS (apps/api/src/plugins/cors.ts), or the browser blocks
// every call with "Failed to fetch". Only listed origins get the cookie back.
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: hasBody
      ? { "Content-Type": "application/json", ...init?.headers }
      : { ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const errorBody = (body as ApiErrorBody) ?? { error: "unknown_error" };
    // A 401 unauthenticated means the session is gone: let the auth context know.
    reportApiFailure(res.status, errorBody.error);
    throw new ApiError(res.status, errorBody);
  }
  return body as T;
}

/** For the routes that answer `204 No Content` (logout, cancel payment
 *  link, delete webhook endpoint) — makes "there is deliberately no body
 *  here" explicit at the call site. */
/**
 * For 204 responses.
 */
export async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  await request<unknown>(path, init);
}

/** Plain-language text for the API's error codes. A code missing from here
 *  falls back to the server's own message, then to the code itself. */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "That merchant ID, email and password don't match an account. Check all three and try again.",
  invalid_code: "That code isn't right. Check the latest code and try again.",
  otp_expired: "That code has expired. Start again to get a new one.",
  too_many_attempts: "Too many wrong codes. Sign in again to get a new one.",
  resend_too_soon: "A code was sent moments ago. Wait 30 seconds before asking for another.",
  no_pending_session: "Your sign-in timed out. Enter your details again.",
  unauthenticated: "Your session has ended. Sign in again to continue.",
  forbidden: "Your role can't do this. Ask an owner or finance user on your account.",
  payment_link_not_found: "This payment link doesn't exist.",
  payment_link_already_paid: "This payment link has already been paid.",
  payment_link_canceled: "This payment link was cancelled by the merchant.",
  payment_link_expired: "This payment link has expired.",
  payment_link_processing: "A payment for this link is already in progress. Try again in a moment.",
  transaction_not_found: "That transaction doesn't exist on this account.",
  settlement_batch_not_found: "That settlement batch doesn't exist on this account.",
  webhook_endpoint_not_found: "That webhook endpoint doesn't exist on this account.",
  webhook_delivery_not_found: "That delivery doesn't exist on this endpoint.",
  endpoint_disabled: "This endpoint is disabled. Enable it before replaying deliveries.",
  invalid_url: "Enter a full https:// address for the endpoint.",
  invalid_date: "Enter dates as day, month and year.",
  invalid_filter: "One of the filters isn't valid. Clear the filters and try again.",
  not_cancelable: "Only active links can be cancelled.",
  not_voidable: "Only authorised payments that haven't been captured can be voided.",
  capture_exceeds_remaining: "That's more than the amount still available to capture.",
  card_declined: "The card was declined.",
  idempotency_key_reused: "This request was already sent with different details. Refresh and try again.",
  internal_error: "Something failed on our side. Try again in a moment.",
  not_implemented: "This isn't available yet.",
};

/** Human-readable text for anything thrown by `request`: used by every
 *  dashboard page's error banner so a failure (including a server-side
 *  `403` from a role gate) is always shown, never silently swallowed. */
/** Codes the server sends for several different reasons, with the reason in
 *  `message` ("webhook URLs must not contain credentials", "... must point
 *  at a public host"). Show that reason; the fixed text is only a fallback. */
const SERVER_REASON_FIRST = new Set(["invalid_url"]);

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = err.body.message;
    if (SERVER_REASON_FIRST.has(err.code) && reason && reason !== err.code) {
      return reason.charAt(0).toUpperCase() + reason.slice(1) + (/[.!?]$/.test(reason) ? "" : ".");
    }
    const known = ERROR_MESSAGES[err.code];
    if (known) return known;
    if (err.statusCode === 403) {
      return "Your role can't do this. Ask an owner or finance user on your account.";
    }
    if (err.statusCode >= 500) return ERROR_MESSAGES.internal_error!;
    return err.body.message ?? err.code.replace(/_/g, " ");
  }
  // fetch() rejects with a TypeError when the API can't be reached at all
  // (offline, API not running, blocked by CORS).
  if (err instanceof TypeError) {
    return "Can't reach FilsPay. Check your connection and try again.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
