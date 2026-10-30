import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The batch page used to draw a "progress bar" whose width was the gross
 * amount divided by 10,000 (so 5.000 BD looked half done and 10.000 BD or
 * more looked finished). A batch has no progress to show, so the bar is
 * gone. Read from source: the page has no rendering test harness.
 */
const page = readFileSync(new URL("./SettlementBatchDetailPage.tsx", import.meta.url), "utf8");

test("the settlement batch page draws no amount-based progress bar", () => {
  assert.doesNotMatch(page, /dash-progress/);
  assert.doesNotMatch(page, /grossFils\s*\/\s*10000/);
});
