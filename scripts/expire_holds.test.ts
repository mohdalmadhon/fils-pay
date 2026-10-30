import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPIRE_HOLDS_SQL } from "./expire_holds.js";
import { buildDelete } from "./lib/sqlFilter.js";

test("the nightly delete carries its own predicate", () => {
  assert.match(EXPIRE_HOLDS_SQL, /^DELETE FROM holds WHERE status = 'active' AND expires_at < now\(\)/);
});

test("buildDelete refuses to build a DELETE with no WHERE clause", () => {
  assert.throws(() => buildDelete("holds", {}));
  assert.throws(() => buildDelete("holds", { id: [] }));
  assert.throws(() => buildDelete("holds", { id: undefined }));
});

test("buildDelete still scopes to the ids it was handed", () => {
  const ids = ["11111111-1111-1111-1111-111111111111"];
  assert.deepEqual(buildDelete("holds", { id: ids }), { text: "DELETE FROM holds WHERE id = ANY($1::uuid[])", values: [ids] });
});
