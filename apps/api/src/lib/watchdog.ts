import { Worker } from "node:worker_threads";

/**
 * Kills the process if its main thread stops responding, so the container's
 * restart policy brings up a fresh one (docs/perf/checkout-capacity.md).
 *
 * A wedged event loop (an endless loop, a synchronous call that never
 * returns) leaves the process alive but deaf: the port stays open, every
 * request hangs, and Docker sees nothing wrong, because it restarts a
 * container only when its process exits. The main thread ticks a shared
 * counter every second; a worker thread, which keeps running when the main
 * thread is stuck, checks it. If the counter hasn't moved for `stallMs`,
 * the worker logs and sends SIGKILL to the whole process.
 *
 * Committed payments are safe across this: every money movement commits in
 * one database transaction before its response is sent, so a killed process
 * loses only requests still in flight, which roll back (or, between
 * authorize and capture, are released by the reservation timeout).
 */
export function startWatchdog(stallMs: number): () => void {
  if (stallMs <= 0) return () => {};
  const beat = new Int32Array(new SharedArrayBuffer(4));
  const tick = setInterval(() => Atomics.add(beat, 0, 1), 1000);
  tick.unref();
  const worker = new Worker(
    `
    const { workerData } = require("node:worker_threads");
    const beat = workerData.beat;
    let last = Atomics.load(beat, 0);
    let since = Date.now();
    setInterval(() => {
      const now = Atomics.load(beat, 0);
      if (now !== last) { last = now; since = Date.now(); return; }
      if (Date.now() - since >= workerData.stallMs) {
        console.error("[watchdog] main thread unresponsive for " + (Date.now() - since) + " ms; killing the process so it is restarted");
        process.kill(process.pid, "SIGKILL");
      }
    }, 1000);
    `,
    { eval: true, workerData: { beat, stallMs } },
  );
  worker.unref();
  return () => {
    clearInterval(tick);
    void worker.terminate();
  };
}
