/**
 * ops/deploy.sh, run with a fake `ssh` on PATH. The fake runs the first,
 * code-copying command locally (with HOME set to a temporary folder that
 * stands in for the server's home) and only records the second one, the
 * remote-deploy.sh start.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const STUB_SSH = `#!/usr/bin/env bash
cmd="\${@: -1}"
if [[ "$cmd" == *"bash ~/fils-pay/ops/remote-deploy.sh"* ]]; then
  printf '%s\\n' "$cmd" > "$SSH_LOG"
else
  HOME="$FAKE_SERVER_HOME" bash -c "$cmd"
fi
`;

function deployTo(server: string, setUpServer?: (home: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-sh-"));
  const bin = join(dir, "bin");
  const home = join(dir, "server-home");
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, "ssh"), STUB_SSH);
  chmodSync(join(bin, "ssh"), 0o755);
  setUpServer?.(home);
  const log = join(dir, "ssh.log");
  execFileSync("bash", ["ops/deploy.sh", server], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSH_LOG: log, FAKE_SERVER_HOME: home },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { dir, home, remoteCommand: readFileSync(log, "utf8") };
}

// docs/bugs/085-deploy-passes-host-name-as-public-ip.md
test("PUBLIC_IP is passed only when the server is given as an IPv4 address", () => {
  for (const [server, expected] of [
    ["dilmune@159.89.173.8", "159.89.173.8"],
    ["deploy@pay.example.test", ""],
    ["myserver", ""],
  ] as const) {
    const { dir, remoteCommand } = deployTo(server);
    try {
      assert.match(remoteCommand, new RegExp(`^PUBLIC_IP='${expected.replace(/\./g, "\\.")}' `), server);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// docs/bugs/086-failed-first-deploy-then-retry-loses-env.md
test("a retry after a failed first deploy keeps the old in-code settings", () => {
  // The first deploy moved the old code (with ops/.env) to ~/fils-pay.old
  // and then failed before remote-deploy.sh copied the settings out.
  const { dir, home } = deployTo("dilmune@159.89.173.8", (home) => {
    mkdirSync(join(home, "fils-pay.old", "ops"), { recursive: true });
    mkdirSync(join(home, "fils-pay", "ops"), { recursive: true });
    writeFileSync(join(home, "fils-pay.old", "ops", ".env"), "POSTGRES_PASSWORD=the-only-copy\n");
    writeFileSync(join(home, "fils-pay.old", "ops", ".env.docker"), "PORT=3000\n");
  });
  try {
    assert.equal(readFileSync(join(home, "fils-pay-config", ".env"), "utf8"), "POSTGRES_PASSWORD=the-only-copy\n");
    assert.equal(readFileSync(join(home, "fils-pay-config", ".env.docker"), "utf8"), "PORT=3000\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the in-code settings of the current deploy are kept, and existing config is never replaced", () => {
  const { dir, home } = deployTo("dilmune@159.89.173.8", (home) => {
    mkdirSync(join(home, "fils-pay", "ops"), { recursive: true });
    mkdirSync(join(home, "fils-pay-config"));
    writeFileSync(join(home, "fils-pay", "ops", ".env"), "POSTGRES_PASSWORD=legacy\n");
    writeFileSync(join(home, "fils-pay", "ops", ".env.docker"), "PORT=1\n");
    writeFileSync(join(home, "fils-pay-config", ".env.docker"), "PORT=3000\n");
  });
  try {
    assert.equal(readFileSync(join(home, "fils-pay-config", ".env"), "utf8"), "POSTGRES_PASSWORD=legacy\n");
    assert.equal(readFileSync(join(home, "fils-pay-config", ".env.docker"), "utf8"), "PORT=3000\n");
    assert.ok(existsSync(join(home, "fils-pay", "ops", "remote-deploy.sh")), "the new code is in place");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
