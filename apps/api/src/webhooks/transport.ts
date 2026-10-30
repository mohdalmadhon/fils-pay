/**
 * The injectable HTTP send — `runDispatchPass` and everything it calls take
 * a `WebhookTransport` as an explicit parameter, never calling `fetch`
 * directly deep inside dispatch logic. Same "pass the effectful dependency
 * in" shape as `AcquirerSimulator`.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { BlockedDestinationError, guardedLookup, isBlockedAddress } from "./destination.js";

/**
 * @property timeoutMs Covers the whole exchange including reading the body.
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransportResponse {
  /** null on a transport-level failure (timeout, DNS, connection refused,
   *  blocked destination — never reached the receiver) */
  statusCode: number | null;
  /** "" on a transport-level failure; at most WEBHOOK_RESPONSE_BODY_LIMIT
   *  bytes otherwise */
  body: string;
  /** present iff statusCode is null */
  errorMessage?: string;
}

export type WebhookTransport = (req: WebhookTransportRequest) => Promise<WebhookTransportResponse>;

/** Bytes of a receiver's response body that are read and kept. Only the
 *  first 2,000 characters are ever stored or shown; the rest is discarded
 *  without being buffered. */
export const WEBHOOK_RESPONSE_BODY_LIMIT = 4_096;

export interface FetchTransportOptions {
  /** Allow loopback/private/link-local destinations. Only for local
   *  development and tests (config.webhookAllowPrivateHosts). */
  allowPrivateHosts: boolean;
}

/**
 * Real transport, used by index.ts's production wiring. Built on node:http(s)
 * rather than fetch so that:
 *   - the resolved address is checked at connect time (guardedLookup), so a
 *     merchant URL can't point the API at the private network or the cloud
 *     metadata service, including through DNS rebinding;
 *   - redirects are never followed (a 3xx is the receiver's answer, and a
 *     non-2xx is a failed delivery anyway);
 *   - the body read stops at WEBHOOK_RESPONSE_BODY_LIMIT bytes.
 */
export function createFetchTransport(options: FetchTransportOptions): WebhookTransport {
  return (req: WebhookTransportRequest): Promise<WebhookTransportResponse> =>
    new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: WebhookTransportResponse) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const fail = (err: unknown) =>
        finish({ statusCode: null, body: "", errorMessage: err instanceof Error ? err.message : String(err) });

      let url: URL;
      try {
        url = new URL(req.url);
      } catch (err) {
        fail(err);
        return;
      }
      const send = url.protocol === "https:" ? httpsRequest : url.protocol === "http:" ? httpRequest : null;
      if (!send) {
        fail(new Error(`unsupported protocol ${url.protocol}`));
        return;
      }

      // node:http skips `lookup` for an IP literal, so check those here.
      const literal = url.hostname.replace(/^\[|\]$/g, "");
      if (!options.allowPrivateHosts && isIP(literal) && isBlockedAddress(literal)) {
        fail(new BlockedDestinationError(url.hostname, literal));
        return;
      }

      const payload = Buffer.from(req.body, "utf8");
      const outgoing = send(url, {
        method: "POST",
        headers: { ...req.headers, "Content-Length": String(payload.length) },
        ...(options.allowPrivateHosts ? {} : { lookup: guardedLookup }),
      });
      timer = setTimeout(() => {
        outgoing.destroy(new Error(`timed out after ${req.timeoutMs}ms`));
      }, req.timeoutMs);

      outgoing.on("error", fail);
      outgoing.on("response", (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish({ statusCode: res.statusCode ?? null, body: Buffer.concat(chunks).toString("utf8") });
        res.on("data", (chunk: Buffer) => {
          if (size >= WEBHOOK_RESPONSE_BODY_LIMIT) return;
          const room = WEBHOOK_RESPONSE_BODY_LIMIT - size;
          const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
          chunks.push(part);
          size += part.length;
          if (size >= WEBHOOK_RESPONSE_BODY_LIMIT) {
            // Enough: stop reading and drop the connection.
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("error", (err) => (size > 0 ? done() : fail(err)));
      });
      outgoing.end(payload);
    });
}
