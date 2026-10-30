import assert from "node:assert/strict";
import test from "node:test";
import { bahrainYesterday } from "./bahrainDate.js";

test("yesterday is the Bahrain day before today, even between 00:00 and 03:00 Bahrain time", () => {
  // 01:30 Bahrain on 12 Sep is 22:30 UTC on 11 Sep. Yesterday is 11 Sep.
  assert.equal(bahrainYesterday(new Date("2026-09-11T22:30:00.000Z")), "2026-09-11");
  // Midday Bahrain on 12 Sep.
  assert.equal(bahrainYesterday(new Date("2026-09-12T09:00:00.000Z")), "2026-09-11");
  // Just before Bahrain midnight, still 12 Sep in Bahrain.
  assert.equal(bahrainYesterday(new Date("2026-09-12T20:59:59.000Z")), "2026-09-11");
  // Across a month and year end.
  assert.equal(bahrainYesterday(new Date("2026-12-31T21:30:00.000Z")), "2026-12-31");
});
