import assert from "node:assert/strict";
import test from "node:test";
import { allLoadedSelected, selectedLoadedIds, toggleAllLoaded } from "./selection.js";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

test("only ids that are selected AND loaded are sent for bulk approval", () => {
  // a and b were selected under the old filter; only b and c are loaded now.
  assert.deepEqual(selectedLoadedIds(new Set(["a", "b"]), rows("b", "c")), ["b"]);
});

test("all-selected compares ids, not counts", () => {
  // Two selected, two loaded, but they are different merchants.
  assert.equal(allLoadedSelected(new Set(["a", "b"]), rows("c", "d")), false);
  assert.equal(allLoadedSelected(new Set(["c", "d"]), rows("c", "d")), true);
  assert.equal(allLoadedSelected(new Set(), rows()), false);
});

test("the header checkbox selects exactly the loaded rows, or clears them", () => {
  assert.deepEqual([...toggleAllLoaded(new Set(["a", "b"]), rows("c", "d"))], ["c", "d"]);
  assert.deepEqual([...toggleAllLoaded(new Set(["c", "d"]), rows("c", "d"))], []);
});
