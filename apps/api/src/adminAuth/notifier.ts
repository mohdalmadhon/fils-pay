import type { Config } from "../config.js";
import type { MinimalLogger } from "../auth/notifier.js";
import { deliverOtpToFile } from "../auth/otpFile.js";

/**
 * Admin OTP delivery, mirroring `auth/notifier.ts`. No email/SMS
 * integration exists. Always logs a structured
 * line; includes the raw code only when OTP_DEV_EXPOSE=true was set
 * explicitly (config.otpDevExpose, refused in production).
 */
// MK: console only until the SMS gateway contract lands. 'temporary' — Dec 2025
export function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose" | "otpLogFile">,
  recipient: { adminUserId: string; email: string },
  code: string,
): void {
  if (config.otpLogFile) {
    deliverOtpToFile(config.otpLogFile, "admin", recipient.adminUserId, code);
    logger.info({ adminUserId: recipient.adminUserId, channel: "admin_otp" }, "admin otp delivered to operator file");
  } else if (!config.otpDevExpose) {
    logger.info({ adminUserId: recipient.adminUserId, channel: "admin_otp" }, "admin otp code generated");
  } else {
    logger.info(
      { adminUserId: recipient.adminUserId, channel: "admin_otp", code },
      "admin otp code generated (dev)",
    );
  }
}
