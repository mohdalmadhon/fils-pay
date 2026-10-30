/**
 * What request logs may contain. Fastify's default request serializer logs
 * the full URL. For the public payment-link routes the token in that URL is
 * the whole credential (anyone holding it can open and pay the link), so it
 * must not end up in log shipping, the docker host's logs or support tools.
 */

const PAYMENT_LINK_TOKEN = /^(\/v1\/payment-links\/)([^/?#]+)/;

export function redactUrl(url: string): string {
  return url.replace(PAYMENT_LINK_TOKEN, "$1[redacted]");
}

interface LoggableRequest {
  method: string;
  url: string;
  headers?: Record<string, unknown>;
  ip?: string;
  hostname?: string;
  socket?: { remotePort?: number };
}

/** Replaces Fastify's `req` serializer: method, redacted URL, host and
 *  client address. No headers (so no Authorization or Cookie), no body. */
export function requestLogSerializer(req: LoggableRequest): {
  method: string;
  url: string;
  host: string | undefined;
  remoteAddress: string | undefined;
  remotePort: number | undefined;
} {
  return {
    method: req.method,
    url: redactUrl(req.url),
    host: req.hostname ?? (typeof req.headers?.host === "string" ? req.headers.host : undefined),
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
