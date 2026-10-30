import assert from "node:assert/strict";
import test from "node:test";
import { isSessionEnded, onSessionEnded, reportApiFailure } from "./sessionEvents.js";

test("a 401 unauthenticated from the API tells the auth context the session has ended", () => {
  let ended = 0;
  const unsubscribe = onSessionEnded(() => {
    ended += 1;
  });
  reportApiFailure(401, "unauthenticated");
  assert.equal(ended, 1);

  unsubscribe();
  reportApiFailure(401, "unauthenticated");
  assert.equal(ended, 1, "no calls after unsubscribing");
});

test("other failures, including a wrong password, do not end the session", () => {
  assert.equal(isSessionEnded(401, "invalid_credentials"), false);
  assert.equal(isSessionEnded(403, "forbidden"), false);
  assert.equal(isSessionEnded(500, "unauthenticated"), false);
  assert.equal(isSessionEnded(401, "unauthenticated"), true);
});
