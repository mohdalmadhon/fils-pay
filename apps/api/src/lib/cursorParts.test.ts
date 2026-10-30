/** Pure. docs/bugs/011. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCalendarDate, isTimestampText } from "./cursorParts.js";

test("real calendar dates pass, impossible ones fail", () => {
  assert.equal(isCalendarDate("2026-10-30"), true);
  assert.equal(isCalendarDate("2028-02-29"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "x", "2026-1-01", ""]) assert.equal(isCalendarDate(bad), false, bad);
});

test("timestamps as Postgres prints them pass, junk fails", () => {
  for (const ok of ["2026-10-30 20:16:34.142043+03", "2026-10-30 17:16:34+00", "2026-10-30T17:16:34.142Z", "2026-10-30 20:16:34+05:30"]) {
    assert.equal(isTimestampText(ok), true, ok);
  }
  for (const bad of ["x", "2026-02-30 10:00:00+03", "2026-10-30 25:00:00+03", "2026-10-30"]) assert.equal(isTimestampText(bad), false, bad);
});
