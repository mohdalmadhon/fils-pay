import type { Config } from "../config.js";
import { deliverOtpToFile } from "./otpFile.js";

/**
 * OTP delivery uses an optional private operator file; no email/SMS integration
 * exists. Normal logs include the raw code only when
 * OTP_DEV_EXPOSE=true was set explicitly (config.otpDevExpose, refused in
 * production). Whoever can read the logs can otherwise finish a login.
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose" | "otpLogFile">,
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  if (config.otpLogFile) {
    deliverOtpToFile(config.otpLogFile, "merchant", recipient.merchantUserId, code);
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp delivered to operator file");
  } else if (!config.otpDevExpose) {
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp code generated");
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
}
