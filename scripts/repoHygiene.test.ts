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

test("no Math.random() in API or reporting code that could feed a secret", async () => {
  // Allowed: the webhook retry jitter default, which only spreads retries.
  const allowed = new Set(["apps/api/src/webhooks/dispatcher.ts"]);
  const offenders: string[] = [];
  const { readFileSync } = await import("node:fs");
  for (const path of tracked) {
    if (!/^apps\/(api|reporting)\/src\/.*\.ts$/.test(path) || path.endsWith(".test.ts") || allowed.has(path)) continue;
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    if (/Math\.random\s*\(/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], "use lib/random.ts (node:crypto) instead");
});
