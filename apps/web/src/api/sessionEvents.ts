/**
 * "The server says this session has ended." `request` in client.ts calls
 * `reportApiFailure` for every failed response; a `401 unauthenticated`
 * tells every subscriber (the auth context), which then switches to
 * anonymous so the route guard sends the user to the login page, keeping
 * the current page as `from`. Without this the auth context kept saying
 * "authenticated" after the session expired, and the login page bounced
 * straight back into the app.
 *
 * Kept apart from client.ts so it can be tested without Vite's
 * `import.meta.env`.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Returns an unsubscribe function. */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True for the API's "no valid session" answer, and nothing else (a wrong
 *  password is `401 invalid_credentials`, which must not sign anyone out). */
export function isSessionEnded(statusCode: number, code: string | undefined): boolean {
  return statusCode === 401 && code === "unauthenticated";
}

export function reportApiFailure(statusCode: number, code: string | undefined): void {
  if (!isSessionEnded(statusCode, code)) return;
  for (const listener of [...listeners]) listener();
}
