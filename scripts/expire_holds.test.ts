import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpiredHoldsDelete } from "./expire_holds.js";
import { buildDelete } from "./lib/sqlFilter.js";

test("the delete is scoped to exactly the ids it was handed", () => {
  const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
  const { text, values } = buildExpiredHoldsDelete(ids);
  assert.equal(text, "DELETE FROM holds WHERE id = ANY($1::uuid[])");
  assert.deepEqual(values, [ids]);
});

test("a single id still goes through the array predicate rather than a bare equality", () => {
  const { text, values } = buildExpiredHoldsDelete(["33333333-3333-3333-3333-333333333333"]);
  assert.equal(text, "DELETE FROM holds WHERE id = ANY($1::uuid[])");
  assert.equal((values[0] as string[]).length, 1);
});


test("a night with nothing expired never builds an unscoped DELETE", () => {
  let built: { text: string } | undefined;
  try {
    built = buildExpiredHoldsDelete([]);
  } catch {
    // refusing to build is fine too
  }
  if (built) {
    assert.match(built.text, /WHERE/, `unscoped statement: ${built.text}`);
  }
});

test("buildDelete refuses to build a DELETE with no WHERE clause", () => {
  assert.throws(() => buildDelete("holds", {}));
  assert.throws(() => buildDelete("holds", { id: [] }));
  assert.throws(() => buildDelete("holds", { id: undefined }));
});
