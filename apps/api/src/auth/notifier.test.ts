/** The OTP code reaches the log only with the explicit dev opt-in. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, logger: { info: (obj: Record<string, unknown>) => void lines.push(obj) } };
}

test("merchant OTP: the code is logged only when otpDevExpose is on", () => {
  const off = capture();
  sendOtpCode(off.logger, { otpDevExpose: false }, { merchantUserId: "u", email: "e" }, "123456");
  assert.equal(JSON.stringify(off.lines).includes("123456"), false);

  const on = capture();
  sendOtpCode(on.logger, { otpDevExpose: true }, { merchantUserId: "u", email: "e" }, "123456");
  assert.equal(on.lines[0]?.code, "123456");
});

test("admin OTP: the code is logged only when otpDevExpose is on", () => {
  const off = capture();
  sendAdminOtpCode(off.logger, { otpDevExpose: false }, { adminUserId: "a", email: "e" }, "654321");
  assert.equal(JSON.stringify(off.lines).includes("654321"), false);
});
