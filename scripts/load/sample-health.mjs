#!/usr/bin/env node
/**
 * The load test's timeline: once a second, asks the API how it is doing
 * (GET /healthz: requests in flight, requests turned away so far, event
 * loop delay) and writes one CSV line. Run it beside
 * scripts/load/checkout-load.mjs; scripts/load/report-html.mjs turns both
 * into graphs. Works on Windows, macOS and Linux (Node 22, no dependencies).
 *
 *   API_URL=http://localhost:3000 OUT=scripts/out/health.csv node scripts/load/sample-health.mjs
 *
 * Stops on Ctrl+C, or after DURATION seconds if set. While the API is down
 * (a crash test) each line says so (`up` = 0), so the gap shows on the
 * graph instead of being skipped.
 *
 * Columns: time (ISO), elapsedS, up (1/0), status (HTTP code or "down"),
 * healthMs (how long /healthz took), inFlight, shedTotal, eventLoopDelayMs,
 * uptimeS (falls back to ~0 when the API restarted).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const API = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = process.env.OUT ?? `scripts/out/health-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
const DURATION = process.env.DURATION ? Number(process.env.DURATION) : Infinity;
const EVERY_MS = Number(process.env.EVERY_MS ?? 1000);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, "time,elapsedS,up,status,healthMs,inFlight,shedTotal,eventLoopDelayMs,uptimeS\n");
const started = Date.now();
let running = true;
process.on("SIGINT", () => {
  running = false;
});

async function sample() {
  const t0 = performance.now();
  let row;
  try {
    const res = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json().catch(() => ({}));
    const load = body.load ?? {};
    row = [1, res.status, Math.round(performance.now() - t0), load.inFlight ?? "", load.shedTotal ?? "", load.eventLoopDelayMs ?? "", Math.round(body.uptimeSeconds ?? 0)];
  } catch {
    row = [0, "down", "", "", "", "", ""];
  }
  const now = new Date();
  appendFileSync(OUT, [now.toISOString(), ((now.getTime() - started) / 1000).toFixed(1), ...row].join(",") + "\n");
}

console.log(`sampling ${API}/healthz every ${EVERY_MS} ms into ${OUT} (Ctrl+C to stop)`);
while (running && (Date.now() - started) / 1000 < DURATION) {
  const next = Date.now() + EVERY_MS;
  await sample();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, next - Date.now())));
}
console.log(`stopped; ${OUT}`);
