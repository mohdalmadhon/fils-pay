import { Client, type Pool } from "pg";
import type { ReportingConfig } from "../config.js";
import { runConsumerPass } from "./runConsumerPass.js";

/**
 * Must match the channel the outbox trigger notifies on (db/migrations);
 * a NOTIFY on any other channel is silently ignored.
 */
const NOTIFY_CHANNEL = "outbox_events_channel";

export interface ReportingConsumerHandle {
  stop(): Promise<void>;
}

/**
 * Starts the reporting consumer: a dedicated LISTEN connection on the
 * webhook dispatcher's existing trigger/channel for near-real-time reaction
 * to fresh outbox_events inserts, plus a poll-interval safety net that
 * guarantees no event is stuck forever even if a NOTIFY is missed —
 * identical shape to apps/api/src/webhooks/dispatcher.ts's
 * `startWebhookDispatcher`.
 */
export function startReportingConsumer(pool: Pool, config: ReportingConfig): ReportingConsumerHandle {
  let running = false;
  let stopped = false;

  // Passes are spaced at least reportingMinPassGapMs apart. Every captured
  // payment sends a NOTIFY, and each pass reads the outbox against the
  // processed-events table, a cost that grows with the outbox. Started on
  // every NOTIFY, back to back under checkout load, the passes took about a
  // fifth of a one-vCPU box away from checkout. Events that arrive during
  // the gap (or during a pass, which used to be ignored until the next poll
  // tick) are picked up together by the next pass. docs/perf/checkout-capacity.md.
  let lastFinished = 0;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let wanted = false;

  const startPass = (): void => {
    scheduled = null;
    if (stopped) return;
    running = true;
    wanted = false;
    runConsumerPass(pool, config)
      .catch((err: unknown) => {
        // A thrown error from one pass must never crash the listener or the
        // process — the next NOTIFY or poll tick simply tries again.
        console.error("[reporting/consumer] consumer pass failed", err);
      })
      .finally(() => {
        running = false;
        lastFinished = Date.now();
        if (wanted) triggerPass();
      });
  };

  const triggerPass = (): void => {
    if (stopped) return;
    if (running) {
      wanted = true;
      return;
    }
    if (scheduled) return;
    const wait = lastFinished + config.reportingMinPassGapMs - Date.now();
    if (wait <= 0) startPass();
    else scheduled = setTimeout(startPass, wait);
  };

  // MK: dedicated Client, not from the pool -- LISTEN needs a pinned connection. DO NOT TOUCH
  // incident 2026-05-14 (missed settlement close): root cause was this client silently losing LISTEN after a pg restart. -- FH
  // am: but the poll covers missed NOTIFYs... and reporting doesn't close batches?? MK: the timeline is in the incident doc. AM: which doc
  const listenClient = new Client({ connectionString: config.databaseUrl });
  let listenClientConnected = false;

  listenClient.on("error", (err: Error) => {
    console.error("[reporting/consumer] LISTEN client error", err);
  });
  listenClient.on("notification", () => {
    triggerPass();
  });

  const connectPromise = listenClient
    .connect()
    .then(async () => {
      listenClientConnected = true;
      await listenClient.query(`LISTEN ${NOTIFY_CHANNEL}`);
      // Run one pass immediately on startup so a restart resumes and
      // catches up on any backlog without waiting for the first NOTIFY or
      // poll tick.
      triggerPass();
    })
    .catch((err: unknown) => {
      // NOTIFY is an optimization, not the sole mechanism — the poll
      // interval below still guarantees eventual processing even if the
      // LISTEN connection never comes up.
      console.error("[reporting/consumer] failed to establish LISTEN connection", err);
    });

  // am: if LISTEN dies the worker stops processing until restart
  const interval = setInterval(triggerPass, config.reportingPollIntervalMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(interval);
      if (scheduled) clearTimeout(scheduled);
      await connectPromise;
      if (listenClientConnected) {
        await listenClient.end().catch(() => {});
      }
    },
  };
}
