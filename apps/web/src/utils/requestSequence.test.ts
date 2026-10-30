import assert from "node:assert/strict";
import test from "node:test";
import { createRequestSequence } from "./requestSequence.js";

test("only the latest request stays current, so an old filter's late answer is dropped", async () => {
  const seq = createRequestSequence();
  const shown: string[] = [];

  // Two fetches: the first (old filter) answers after the second (new filter).
  async function fetchAndShow(label: string, delayMs: number): Promise<void> {
    const isCurrent = seq.begin();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (isCurrent()) shown.push(label);
  }
  await Promise.all([fetchAndShow("old filter", 20), fetchAndShow("new filter", 1)]);

  assert.deepEqual(shown, ["new filter"]);
});

test("a check stays true until another request begins", () => {
  const seq = createRequestSequence();
  const first = seq.begin();
  assert.equal(first(), true);
  const second = seq.begin();
  assert.equal(first(), false);
  assert.equal(second(), true);
});
