import assert from "node:assert/strict";
import test from "node:test";
import { bahrainToday, bahrainYesterday } from "./bahrainDate.js";

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

test("today is the Bahrain calendar date, whatever the browser's time zone", () => {
  // 01:30 Bahrain on 12 Sep (22:30 UTC on 11 Sep): the server already calls this 12 Sep.
  assert.equal(bahrainToday(new Date("2026-09-11T22:30:00.000Z")), "2026-09-12");
  // 23:30 Bahrain on 12 Sep (20:30 UTC): a browser in UTC+4 would already say 13 Sep.
  assert.equal(bahrainToday(new Date("2026-09-12T20:30:00.000Z")), "2026-09-12");
});
