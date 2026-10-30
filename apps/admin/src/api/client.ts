import type { ApiErrorBody } from "../types.js";
import { reportApiFailure } from "./sessionEvents.js";

const API_BASE_URL =
  (import.meta.env.VITE_ADMIN_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

/** apps/web's own dashboard origin — where a "view as merchant" grant is
 *  actually exercised. */
// FH: used to build the impersonation link
export const WEB_BASE_URL =
  (import.meta.env.VITE_WEB_BASE_URL as string | undefined) ?? "http://localhost:5173";

/** Mirrors apps/api's own uniform `{ error, message? }` body
 *  (lib/errors.ts / plugins/errorHandler.ts) — one error shape end to
 *  end, not reinvented client-side. Identical to apps/web's ApiError. */
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
 * `credentials: "include"` on every call: the admin plane is cookie-based
 * (`fp_admin_sid`), and the admin origin (5174) is not the API origin
 * (3000), so the session cookie only rides along when it is asked for
 * explicitly.
 *
 * `Content-Type: application/json` is sent only when there actually is a
 * body. Several admin routes take none at all (logout, balance rebuild,
 * start/end impersonation), and Fastify rejects a request that declares a
 * JSON content type while carrying an empty body (`FST_ERR_CTP_EMPTY_JSON_BODY`).
 */
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

/** For the routes that answer `204 No Content` (logout, end
 *  impersonation) — a bare `request<void>` would work, but this makes
 *  "there is deliberately no body here" explicit at the call site. */
export async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  await request<unknown>(path, init);
}

/** Human-readable text for anything thrown by `request` — used by every
 *  page's error banner so a failure (including a server-side `403` from a
 *  role gate) is always *shown*, never silently swallowed. */
/** Plain-language text for the API's error codes; anything missing falls
 *  back to the server's message, then to the code. */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match a staff account.",
  invalid_code: "That code isn't right. Check the latest code and try again.",
  otp_expired: "That code has expired. Sign in again to get a new one.",
  too_many_attempts: "Too many wrong codes. Sign in again to get a new one.",
  no_pending_session: "Your sign-in timed out. Enter your details again.",
  unauthenticated: "Your session has ended. Sign in again to continue.",
  forbidden: "Your admin role can't do this. Ask a finance or super admin.",
  merchant_not_found: "That merchant doesn't exist.",
  self_approval_forbidden: "You requested this credit, so someone else has to approve it.",
  credit_request_not_pending: "This credit has already been approved or rejected.",
  api_key_already_revoked: "That key was already revoked. Rotate the merchant's current key instead.",
  import_too_large: "That file has too many rows. Split it and import each part.",
  invalid_csv_header: "The first line must be merchantId,amount,reason.",
  settlement_unreachable: "The settlement service isn't responding. Try again in a minute.",
  endpoint_disabled: "That endpoint is disabled. The merchant has to enable it first.",
  internal_error: "Something failed on our side. Try again in a moment.",
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const known = ERROR_MESSAGES[err.code];
    if (known && !(err.code === "invalid_csv_header" && err.body.message)) return known;
    if (err.statusCode === 403) return "Your admin role can't do this. Ask a finance or super admin.";
    if (err.statusCode >= 500) return ERROR_MESSAGES.internal_error!;
    return err.body.message ?? err.code.replace(/_/g, " ");
  }
  if (err instanceof TypeError) {
    return "Can't reach the FilsPay API. Check your connection and that the API is running.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
