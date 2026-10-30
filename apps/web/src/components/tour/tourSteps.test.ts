import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_TOUR,
  TOUR_SEEN_KEY,
  availableSteps,
  hasSeenTour,
  markTourSeen,
  nextTourIndex,
  tourProgress,
} from "./tourSteps.js";

test("steps whose element is missing are left out; untargeted steps stay", () => {
  const steps = availableSteps(DASHBOARD_TOUR, (target) => target !== "edit-layout" && target !== "theme");
  assert.deepEqual(
    steps.map((s) => s.id),
    ["welcome", "nav", "search", "main", "tour"],
  );
  assert.deepEqual(
    availableSteps(DASHBOARD_TOUR, () => false).map((s) => s.id),
    ["welcome"],
  );
});

test("every targeted step has a target id and every step has words", () => {
  const ids = new Set<string>();
  for (const step of DASHBOARD_TOUR) {
    assert.ok(step.title.length > 0 && step.body.length > 0, step.id);
    assert.ok(!ids.has(step.id), `duplicate ${step.id}`);
    ids.add(step.id);
  }
});

test("next, back and skip", () => {
  assert.equal(nextTourIndex(0, 3, "next"), 1);
  assert.equal(nextTourIndex(2, 3, "next"), null, "next on the last step finishes");
  assert.equal(nextTourIndex(2, 3, "back"), 1);
  assert.equal(nextTourIndex(0, 3, "back"), 0, "back on the first step stays");
  assert.equal(nextTourIndex(1, 3, "skip"), null, "skip ends at once");
});

test("progress text", () => {
  assert.equal(tourProgress(0, 7), "Step 1 of 7");
  assert.equal(tourProgress(6, 7), "Step 7 of 7");
});

test("seen flag round-trips and survives broken storage", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(hasSeenTour(storage), false);
  markTourSeen(storage);
  assert.equal(data.get(TOUR_SEEN_KEY), "1");
  assert.equal(hasSeenTour(storage), true);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(hasSeenTour(throwing), false);
  assert.doesNotThrow(() => markTourSeen(throwing));
});
