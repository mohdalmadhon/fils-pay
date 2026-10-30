import type { Config } from "../config.js";

/**
 * OTP delivery stub. No real email/SMS integration exists or is needed at
 * this stage. Always logs a structured line; includes the raw code only when
 * OTP_DEV_EXPOSE=true was set explicitly (config.otpDevExpose, refused in
 * production). Whoever can read the logs can otherwise finish a login.
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose">,
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  if (!config.otpDevExpose) {
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp code generated");
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
}
