/**
 * ops/remote-deploy.sh writes ~/fils-pay-config/.env. Secrets must survive a
 * redeploy, but the addresses must follow SITE_HOST, OPS_HOST and HTTP_ONLY
 * on every run. Before the fix they were only written on the first deploy,
 * so later HTTP_ONLY/SITE_HOST/OPS_HOST changes had no effect.
 * docs/bugs/082-deploy-ignores-changed-site-host-and-http-only.md.
 *
 * Runs the real script with a fake `docker` and `curl` on PATH and a
 * temporary HOME, from a copy of the script in a temporary folder (the
 * script writes into its own ops/ folder).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const STUB_DOCKER = `#!/usr/bin/env bash
# "compose ps" lists web as running, so the script skips its port check.
case "$*" in
  *"ps --status running"*) echo web ;;
esac
exit 0
`;
const STUB_CURL = `#!/usr/bin/env bash
exit 0
`;

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), "remote-deploy-"));
  const home = join(dir, "home");
  const root = join(home, "fils-pay");
  const bin = join(dir, "bin");
  mkdirSync(join(root, "ops"), { recursive: true });
  mkdirSync(bin);
  copyFileSync("ops/remote-deploy.sh", join(root, "ops", "remote-deploy.sh"));
  writeFileSync(join(bin, "docker"), STUB_DOCKER);
  writeFileSync(join(bin, "curl"), STUB_CURL);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  const deploy = (env: Record<string, string>) =>
    execFileSync("bash", [join(root, "ops", "remote-deploy.sh")], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, USER: "test", SEED: "0", SHOW_OTP: "0", ...env },
      encoding: "utf8",
    });
  const settings = () =>
    Object.fromEntries(
      readFileSync(join(home, "fils-pay-config", ".env"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  const lines = () => readFileSync(join(home, "fils-pay-config", ".env"), "utf8").split("\n").filter(Boolean);
  return { dir, deploy, settings, lines };
}

test("a redeploy updates the addresses and keeps the secrets", () => {
  const { dir, deploy, settings, lines } = setUp();
  try {
    deploy({ PUBLIC_IP: "203.0.113.7" });
    const first = settings();
    assert.equal(first.SITE_ADDRESS, "203-0-113-7.sslip.io");
    assert.equal(first.PUBLIC_SITE_URL, "https://203-0-113-7.sslip.io");
    assert.equal(first.COOKIE_SECURE, "true");

    deploy({ PUBLIC_IP: "203.0.113.7", HTTP_ONLY: "1", SITE_HOST: "pay.example.test", OPS_HOST: "ops.example.test" });
    const second = settings();
    assert.equal(second.SITE_ADDRESS, "http://pay.example.test");
    assert.equal(second.OPS_ADDRESS, "http://ops.example.test");
    assert.equal(second.COOKIE_SECURE, "false");
    assert.equal(second.PUBLIC_SITE_URL, "http://pay.example.test");
    assert.equal(second.PUBLIC_OPS_URL, "http://ops.example.test");

    for (const secret of ["POSTGRES_PASSWORD", "API_DB_PASSWORD", "WEBHOOK_SECRET_ENCRYPTION_KEY", "SETTLEMENT_INTERNAL_TOKEN"]) {
      assert.ok(first[secret], `${secret} was written`);
      assert.equal(second[secret], first[secret], `${secret} must not change on a redeploy`);
    }
    // Each key appears once, so nothing depends on which duplicate wins.
    const keys = lines().map((l) => l.slice(0, l.indexOf("=")));
    assert.deepEqual(keys, [...new Set(keys)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
