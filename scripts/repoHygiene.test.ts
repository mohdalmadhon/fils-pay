/**
 * Repo hygiene: environment files with real values must never be tracked.
 * Only `*.example` templates may be committed. Runs `git ls-files`, so it
 * needs to run inside the repository.
 *
 * Before the fix ops/.env.docker was tracked (with the acquirer callback
 * signing secret in it) even though its own comment said it was gitignored.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

test("no .env files are tracked, only .example templates", () => {
  const envFiles = tracked.filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !p.endsWith(".example"));
  assert.deepEqual(envFiles, [], `tracked environment files: ${envFiles.join(", ")}`);
});

test(".gitignore covers .env.* variants", () => {
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "ops/.env.docker", "apps/api/.env.production"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(ignored.sort(), ["apps/api/.env.production", "ops/.env.docker"]);
});
