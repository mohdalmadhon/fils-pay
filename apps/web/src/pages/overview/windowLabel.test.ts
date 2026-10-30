import assert from "node:assert/strict";
import test from "node:test";
import { windowLabel } from "./windowLabel.js";

const now = new Date("2026-10-30T09:00:00.000Z"); // 12:00 in Bahrain, 30 Oct

test("the label names the requested window, not the number of days with data", () => {
  // The server's default window, whatever days happen to have captures.
  assert.equal(windowLabel("", "", now), "in the last 30 days and today");
  // `to` is exclusive, so the last day shown is the day before it.
  assert.equal(windowLabel("2026-09-01", "2026-10-01", now), "from 2026-09-01 to 2026-09-30");
  assert.equal(windowLabel("2026-09-12", "2026-09-13", now), "on 2026-09-12");
  assert.equal(windowLabel("2026-10-01", "", now), "since 2026-10-01");
  // A blank `from` is 30 days before today (Bahrain).
  assert.equal(windowLabel("", "2026-10-15", now), "from 2026-09-30 to 2026-10-14");
});
