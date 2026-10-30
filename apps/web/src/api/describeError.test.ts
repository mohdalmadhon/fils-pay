import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, describeError } from "./client.js";

test("invalid_url shows the server's reason when it gives one", () => {
  assert.equal(
    describeError(new ApiError(400, { error: "invalid_url", message: "webhook URLs must not contain credentials" })),
    "Webhook URLs must not contain credentials.",
  );
  assert.equal(
    describeError(new ApiError(400, { error: "invalid_url", message: "webhook URLs must point at a public host" })),
    "Webhook URLs must point at a public host.",
  );
});

test("invalid_url without a reason keeps the general hint", () => {
  // The API sets message to the code itself when it has nothing to add.
  assert.equal(
    describeError(new ApiError(400, { error: "invalid_url", message: "invalid_url" })),
    "Enter a full https:// address for the endpoint.",
  );
  assert.equal(describeError(new ApiError(400, { error: "invalid_url" })), "Enter a full https:// address for the endpoint.");
});
