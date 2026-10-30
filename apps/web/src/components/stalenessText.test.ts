import assert from "node:assert/strict";
import test from "node:test";
import { relativeAge, stalenessText } from "./stalenessText.js";

test("the staleness badge shows the date and how old the data is, not just a time", () => {
  const now = new Date("2026-10-30T11:05:00.000Z");
  const text = stalenessText("2026-10-29T11:05:00.000Z", now, { locale: "en-GB", timeZone: "Asia/Bahrain" });
  assert.match(text, /29 Oct 2026/);
  assert.match(text, /14:05/);
  assert.match(text, /\(1 day ago\)$/);
});

test("relative age reads naturally", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  assert.equal(relativeAge(new Date("2026-10-30T11:59:40.000Z"), now), "just now");
  assert.equal(relativeAge(new Date("2026-10-30T11:55:00.000Z"), now), "5 min ago");
  assert.equal(relativeAge(new Date("2026-10-30T09:00:00.000Z"), now), "3 h ago");
  assert.equal(relativeAge(new Date("2026-10-28T12:00:00.000Z"), now), "2 days ago");
});
