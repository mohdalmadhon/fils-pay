/**
 * ops/deploy.sh sends the code with `git archive`. On Git for Windows the
 * default core.autocrlf=true made that archive carry CRLF line endings, and
 * bash on the server then failed on `set -euo pipefail` ("set: pipefail:
 * invalid option name"). docs/bugs/080-deploy-from-windows-sends-crlf-scripts.md.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const git = (args: string[]) => execFileSync("git", args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
const tracked = git(["ls-files"]).toString("utf8").split("\n").filter(Boolean);
const shellScripts = tracked.filter((p) => p.endsWith(".sh"));

test("every shell script is checked out and archived with LF endings", () => {
  assert.ok(shellScripts.length > 0);
  const attrs = git(["check-attr", "eol", "--", ...shellScripts]).toString("utf8").trim().split("\n");
  for (const line of attrs) assert.match(line, /: eol: lf$/, line);
});

test("an archive made with core.autocrlf=true (the Git for Windows default) has no CR in shell scripts", () => {
  // --worktree-attributes: use the .gitattributes being tested, even before
  // it is committed. HEAD holds the committed scripts.
  const tar = git(["-c", "core.autocrlf=true", "archive", "--worktree-attributes", "--format=tar", "HEAD", "--", ...shellScripts]);
  assert.equal(tar.includes(Buffer.from("\r\n")), false, "CRLF found in the archived shell scripts");
});

test("ops/deploy.sh archives with core.autocrlf=false", () => {
  const deploy = readFileSync("ops/deploy.sh", "utf8");
  assert.match(deploy, /git -c core\.autocrlf=false archive/);
});
