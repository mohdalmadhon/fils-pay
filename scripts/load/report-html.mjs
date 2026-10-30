#!/usr/bin/env node
/**
 * Turns a load-test run into one self-contained HTML page of graphs (inline
 * SVG, no libraries, opens offline): capacity per step, latency, what was
 * turned away, the API's own health second by second, payments captured per
 * second from the database, and the crash test with its events marked.
 *
 *   node scripts/load/report-html.mjs <run dir> [out.html]
 *
 * The run directory holds whichever of these exist (missing ones are left
 * out of the page):
 *   ramp.json, crash.json            checkout-load.mjs reports
 *   ramp-health.csv, crash-health.csv  sample-health.mjs timelines
 *   ramp-tps.csv, crash-tps.csv      export-throughput.mjs (from the database)
 *   resources.csv                    time,apiPid,cpuPct,rssMB (optional)
 *   events.log                       "<ISO time> <what happened>" per line
 *   ramp-verify.out, crash-verify.out  verify-db.mjs output
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: report-html.mjs <run dir> [out.html]");
  process.exit(2);
}
const out = process.argv[3] ?? join(dir, "report.html");
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
const json = (f) => (read(f) ? JSON.parse(read(f)) : null);
const csv = (f) => {
  const text = read(f);
  if (!text) return null;
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- tiny SVG charts -----------------------------------------------------
const W = 760;
const H = 280;
const M = { l: 56, r: 16, t: 16, b: 40 };
const COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function ticks(max, n = 5) {
  return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
}
const fmt = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(v < 10 && v % 1 ? 1 : 0)}`);

/**
 * series: [{ name, points: [[x, y|null]], color?, dashed? }]
 * opts: { xLabel, yLabel, xIsTime (seconds), markers: [{x, label}], bands: [{from, to, label}], yMax, logY? }
 */
function lineChart(series, opts) {
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]).filter((y) => y !== null && Number.isFinite(y)));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = opts.yMax ?? niceMax(Math.max(...ys, 0));
  const x = (v) => M.l + ((v - xMin) / (xMax - xMin || 1)) * (W - M.l - M.r);
  const y = (v) => H - M.b - (Math.min(v, yMax) / yMax) * (H - M.t - M.b);
  let svg = "";
  for (const b of opts.bands ?? []) {
    svg += `<rect x="${x(b.from)}" y="${M.t}" width="${Math.max(2, x(b.to) - x(b.from))}" height="${H - M.t - M.b}" fill="var(--band)"/>`;
    svg += `<text x="${x(b.from) + 4}" y="${M.t + 12}" class="bandlabel">${esc(b.label)}</text>`;
  }
  for (const t of ticks(yMax)) {
    svg += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${M.l - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${fmt(t)}</text>`;
  }
  const xTicks = opts.xTicks ?? ticks(xMax - xMin, 6).map((t) => t + xMin);
  for (const t of xTicks) {
    svg += `<text x="${x(t)}" y="${H - M.b + 16}" class="tick" text-anchor="middle">${opts.xIsTime ? `${Math.round(t)}s` : fmt(t)}</text>`;
  }
  for (const m of opts.markers ?? []) {
    svg += `<line x1="${x(m.x)}" x2="${x(m.x)}" y1="${M.t}" y2="${H - M.b}" class="marker"/>`;
  }
  series.forEach((s, i) => {
    const color = s.color ?? COLORS[i % COLORS.length];
    let d = "";
    let pen = false;
    for (const [px, py] of s.points) {
      if (py === null || !Number.isFinite(py)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(px).toFixed(1)},${y(py).toFixed(1)}`;
      pen = true;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${s.dashed ? ' stroke-dasharray="5 4"' : ""}/>`;
    if (s.dots) for (const [px, py] of s.points) if (py !== null) svg += `<circle cx="${x(px)}" cy="${y(py)}" r="3.5" fill="${color}"/>`;
  });
  svg += `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" class="axis" text-anchor="middle">${esc(opts.xLabel)}</text>`;
  svg += `<text transform="translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)" class="axis" text-anchor="middle">${esc(opts.yLabel)}</text>`;
  const legend = series.map((s, i) => `<span><i style="background:${s.color ?? COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join("");
  const markerList = (opts.markers ?? []).length
    ? `<ol class="markers">${opts.markers.map((m) => `<li><b>${opts.xIsTime ? `${Math.round(m.x)}s` : m.x}</b> ${esc(m.label)}</li>`).join("")}</ol>`
    : "";
  return `<div class="chart"><div class="legend">${legend}</div><div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.yLabel)} by ${esc(opts.xLabel)}">${svg}</svg></div>${markerList}</div>`;
}

/** Stacked bars per step. groups: [{ label, parts: {name: value} }] */
function stackedBars(groups, names, opts) {
  const totals = groups.map((g) => names.reduce((s, n) => s + (g.parts[n] ?? 0), 0));
  const yMax = niceMax(Math.max(...totals, 1));
  const bw = (W - M.l - M.r) / groups.length;
  const y = (v) => H - M.b - (v / yMax) * (H - M.t - M.b);
  let svg = "";
  for (const t of ticks(yMax)) svg += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${M.l - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${fmt(t)}</text>`;
  groups.forEach((g, i) => {
    let acc = 0;
    names.forEach((n, j) => {
      const v = g.parts[n] ?? 0;
      if (v > 0) svg += `<rect x="${M.l + i * bw + bw * 0.15}" y="${y(acc + v)}" width="${bw * 0.7}" height="${y(acc) - y(acc + v)}" fill="${COLORS[j]}"><title>${esc(n)}: ${v}</title></rect>`;
      acc += v;
    });
    svg += `<text x="${M.l + i * bw + bw / 2}" y="${H - M.b + 16}" class="tick" text-anchor="middle">${esc(g.label)}</text>`;
  });
  svg += `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" class="axis" text-anchor="middle">${esc(opts.xLabel)}</text>`;
  svg += `<text transform="translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)" class="axis" text-anchor="middle">${esc(opts.yLabel)}</text>`;
  const legend = names.map((n, j) => `<span><i style="background:${COLORS[j]}"></i>${esc(n)}</span>`).join("");
  return `<div class="chart"><div class="legend">${legend}</div><div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.yLabel)}">${svg}</svg></div></div>`;
}

// ---- data ----------------------------------------------------------------
const ramp = json("ramp.json");
const crash = json("crash.json");
const events = (read("events.log") ?? "")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => ({ t: Date.parse(l.slice(0, l.indexOf(" "))), text: l.slice(l.indexOf(" ") + 1) }));
const resources = csv("resources.csv");
const secondsFrom = (t0) => (iso) => (Date.parse(iso) - t0) / 1000;

function timelineSection(prefix, title, intro) {
  const health = csv(`${prefix}-health.csv`);
  const tps = csv(`${prefix}-tps.csv`);
  if (!health) return "";
  const t0 = Date.parse(health[0].time);
  const t1 = Date.parse(health[health.length - 1].time);
  const at = secondsFrom(t0);
  const down = [];
  let start = null;
  for (const r of health) {
    if (r.up === "0" && start === null) start = at(r.time);
    if (r.up === "1" && start !== null) {
      down.push({ from: start, to: at(r.time), label: "API not answering" });
      start = null;
    }
  }
  if (start !== null) down.push({ from: start, to: at(health[health.length - 1].time), label: "API not answering" });
  const markers = events.filter((e) => e.t >= t0 && e.t <= t1 && /kill|restart|postgres up|supervisor|step started/.test(e.text)).map((e) => ({ x: (e.t - t0) / 1000, label: e.text.replace(/^crash: /, "") }));
  let html = `<section><h2>${title}</h2><p class="lede">${intro}</p>`;
  if (tps) {
    const pts = tps.map((r) => [at(r.time), Number(r.captured)]).filter(([x]) => x >= 0 && x <= (t1 - t0) / 1000);
    html += `<h3>Payments captured per second (from the database)</h3>` + lineChart([{ name: "captured / s", points: pts }], { xLabel: "seconds since the start", yLabel: "captures per second", xIsTime: true, markers, bands: down });
  }
  html += `<h3>API health, second by second</h3>`;
  html += lineChart(
    [
      { name: "requests in flight", points: health.map((r) => [at(r.time), r.up === "1" ? Number(r.inFlight) : null]) },
      { name: "health check time (ms)", points: health.map((r) => [at(r.time), r.up === "1" ? Number(r.healthMs) : null]) },
      { name: "event-loop delay (ms)", points: health.map((r) => [at(r.time), r.up === "1" ? Number(r.eventLoopDelayMs) : null]) },
    ],
    { xLabel: "seconds since the start", yLabel: "count / milliseconds", xIsTime: true, markers, bands: down },
  );
  const shed = [];
  let base = 0;
  let prev = 0;
  for (const r of health) {
    if (r.up !== "1") continue;
    const v = Number(r.shedTotal);
    if (v < prev) base += prev; // restarted: the counter began again
    prev = v;
    shed.push([at(r.time), base + v]);
  }
  html += `<h3>Requests turned away with 503 (running total)</h3>` + lineChart([{ name: "turned away so far", points: shed, color: "var(--s3)" }], { xLabel: "seconds since the start", yLabel: "requests", xIsTime: true, markers, bands: down });
  if (resources) {
    const rs = resources.filter((r) => Date.parse(r.time) >= t0 && Date.parse(r.time) <= t1);
    if (rs.length) {
      html += `<h3>API process: CPU and memory</h3>` + lineChart(
        [
          { name: "CPU % of one core", points: rs.map((r) => [at(r.time), r.cpuPct === "" ? null : Number(r.cpuPct)]) },
          { name: "memory (MB)", points: rs.map((r) => [at(r.time), r.rssMB === "" ? null : Number(r.rssMB)]), color: "var(--s2)" },
        ],
        { xLabel: "seconds since the start", yLabel: "% / MB", xIsTime: true, markers, bands: down },
      );
    }
  }
  return html + "</section>";
}

function stepsTable(report) {
  const rows = report.steps
    .map(
      (s) =>
        `<tr${s.fastAndCorrect ? ' class="ok"' : ""}><td>${s.users}</td><td>${s.completedPerSecond}</td><td>${s.p50}</td><td>${s.p95}</td><td>${s.p99}</td><td>${s.buyerP95}</td><td>${s.paid}</td><td>${s.declined + s.acquirer}</td><td>${s.shedResponses}</td><td>${s.errors}</td><td>${s.fastAndCorrect ? "yes" : "no"}</td></tr>`,
    )
    .join("");
  return `<div class="scroll"><table><thead><tr><th>Buyers at once</th><th>Checkouts / s</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>Buyer p95 ms (with waits)</th><th>Paid</th><th>Declined (simulated)</th><th>Asked to retry (503)</th><th>Errors</th><th>Fast and correct</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

let body = "";
if (ramp) {
  const steps = ramp.steps;
  const cap = ramp.capacity;
  const knee = steps.find((s) => s.shedResponses > 0 || s.p95 > ramp.p95LimitMs);
  const peak = steps.reduce((a, s) => (s.completedPerSecond > a.completedPerSecond ? s : a), steps[0]);
  body += `<section><h2>Capacity</h2><div class="tiles">
    <div class="tile"><span>Largest load served fast and with no errors</span><b>${cap ? cap.users : "none"}</b><small>buyers checking out at once, back to back</small></div>
    <div class="tile"><span>Throughput there</span><b>${cap ? cap.completedPerSecond : "-"}/s</b><small>checkouts a second, p95 ${cap ? cap.p95 : "-"} ms</small></div>
    <div class="tile"><span>Most it ever did</span><b>${peak.completedPerSecond}/s</b><small>at ${peak.users} buyers</small></div>
    <div class="tile"><span>Starts turning buyers away from</span><b>${knee ? knee.users : "never"}</b><small>buyers; the rest wait a second (503, Retry-After)</small></div>
  </div>`;
  const xTicks = steps.map((s) => s.users);
  body += `<h3>Throughput: checkouts finished per second</h3>` + lineChart([{ name: "checkouts / s", points: steps.map((s) => [s.users, s.completedPerSecond]), dots: true }], { xLabel: "buyers checking out at once", yLabel: "checkouts per second", xTicks });
  body += `<h3>How long a checkout takes</h3>` + lineChart(
    [
      { name: "p50", points: steps.map((s) => [s.users, s.p50]), dots: true },
      { name: "p95", points: steps.map((s) => [s.users, s.p95]), dots: true },
      { name: "p99", points: steps.map((s) => [s.users, s.p99]), dots: true },
      { name: "buyer p95 incl. waiting to retry", points: steps.map((s) => [s.users, s.buyerP95]), dots: true, dashed: true },
    ],
    { xLabel: "buyers checking out at once", yLabel: "milliseconds", xTicks },
  );
  body += `<h3>What happened to each checkout</h3>` + stackedBars(
    steps.map((s) => ({ label: String(s.users), parts: { paid: s.paid, "declined (simulated card/acquirer)": s.declined + s.acquirer, "still turned away at the end": s.shed, errors: s.errors } })),
    ["paid", "declined (simulated card/acquirer)", "still turned away at the end", "errors"],
    { xLabel: "buyers checking out at once", yLabel: "checkouts in the 30 s step" },
  );
  body += `<h3>Every step</h3>` + stepsTable(ramp) + `<p class="note">Fast and correct: p95 within ${ramp.p95LimitMs} ms, nobody asked to retry, no errors. Correctness check afterwards: ${ramp.problems?.length ? `<b>${ramp.problems.length} problems</b>` : "every paid link reads paid with its captured transaction; nothing turned away or declined was charged"}.</p></section>`;
}
body += timelineSection("ramp", "The ramp, second by second", "Buyers added in steps every 30 seconds. Throughput comes from the database; the health numbers from the API itself.");
if (crash) {
  const s = crash.steps[0];
  body += timelineSection(
    "crash",
    "Crash test",
    `${s.users} buyers checking out for ${crash.stepSeconds} s. Part way through the API process is killed (kill -9, no clean shutdown, in the middle of payments), then the database is killed the same way. A supervisor restarts both, as Docker's restart policy does.`,
  );
  body += `<section><h2>Crash test: what the buyers saw</h2>${stepsTable(crash)}<p class="note">Errors are checkouts that met a dropped connection or a 5xx and never got through before the step ended; "recovered" checkouts (${s.recoveredAfterFailure}) met one and went through on a retry. Load-tool correctness check: ${crash.problems?.length ? `<b>${crash.problems.length} problems</b>: ${esc(crash.problems.slice(0, 3).join("; "))}` : "no problems"}.</p></section>`;
}
for (const [f, title] of [["ramp-verify.out", "Database check after the ramp"], ["crash-verify.out", "Database check after the crash test"]]) {
  const t = read(f);
  if (t) body += `<section><h2>${title}</h2><pre>${esc(t.trim())}</pre></section>`;
}
if (events.length) body += `<section><h2>Event log</h2><pre>${esc(read("events.log").trim())}</pre></section>`;

const html = `<title>FilsPay Load Test</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{--bg:#f3f6fb;--card:#fff;--ink:#0a1330;--ink2:#44516f;--line:#d5deee;--grid:#e3e9f4;--s1:#1d4ed8;--s2:#0f8a6a;--s3:#d9480f;--s4:#9a6b00;--band:rgba(217,72,15,.12);--ok:#e7f6ee;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1020;--card:#121a30;--ink:#e8edf8;--ink2:#a9b5cf;--line:#26324f;--grid:#1d2742;--s1:#7fb0ff;--s2:#4fd1a9;--s3:#ff8a5b;--s4:#e7c35a;--band:rgba(255,138,91,.16);--ok:#12301f;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0b1020;--card:#121a30;--ink:#e8edf8;--ink2:#a9b5cf;--line:#26324f;--grid:#1d2742;--s1:#7fb0ff;--s2:#4fd1a9;--s3:#ff8a5b;--s4:#e7c35a;--band:rgba(255,138,91,.16);--ok:#12301f;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px}
main{max-width:920px;margin:0 auto;display:grid;gap:20px}
h1{font-size:1.7rem;margin:0;text-wrap:balance}h2{font-size:1.25rem;margin:0 0 8px}h3{font-size:.95rem;margin:18px 0 6px;color:var(--ink2)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0}
.lede,.note{color:var(--ink2);margin:0 0 8px;max-width:70ch}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.tile{border:1px solid var(--line);border-radius:8px;padding:12px;display:grid;gap:2px}.tile span{font-size:.8rem;color:var(--ink2)}.tile b{font-size:1.6rem;font-variant-numeric:tabular-nums}.tile small{color:var(--ink2)}
.chart{margin:4px 0 8px}.scroll{overflow-x:auto}svg{width:100%;min-width:520px;height:auto;display:block}
.grid{stroke:var(--grid)}.tick{fill:var(--ink2);font-size:11px}.axis{fill:var(--ink2);font-size:12px}.marker{stroke:var(--ink2);stroke-dasharray:3 3}.bandlabel{fill:var(--s3);font-size:11px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:.85rem;color:var(--ink2);margin-bottom:4px}.legend i{display:inline-block;width:12px;height:3px;margin-right:6px;vertical-align:middle}
.markers{font-size:.82rem;color:var(--ink2);margin:6px 0 0;padding-left:18px}
table{border-collapse:collapse;width:100%;font-size:.85rem;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}tr.ok td{background:var(--ok)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-size:.8rem;white-space:pre}
</style>
<main>
<header><h1>FilsPay load test</h1><p class="lede">Generated ${esc(new Date().toISOString())} from <code>${esc(dir)}</code>${ramp ? `, against ${esc(ramp.api)}` : ""}.</p></header>
${body}
</main>`;
writeFileSync(out, html);
console.log(`wrote ${out}`);
