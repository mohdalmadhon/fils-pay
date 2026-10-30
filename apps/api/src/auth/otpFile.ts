import { closeSync, constants, fstatSync, openSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Temporary operator delivery channel. Keep the directory private and outside
 * the web root; readers of this file can complete pending logins. */
export function deliverOtpToFile(
  path: string,
  channel: "merchant" | "admin",
  userId: string,
  code: string,
): void {
  if (!isAbsolute(path)) throw new Error("OTP_LOG_FILE must be an absolute path");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("OTP_LOG_FILE must be a private, singly linked file owned by the backend user");
    }
    const line = Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), channel, userId, code }) + "\n");
    let offset = 0;
    while (offset < line.length) offset += writeSync(fd, line, offset);
  } finally {
    closeSync(fd);
  }
}
