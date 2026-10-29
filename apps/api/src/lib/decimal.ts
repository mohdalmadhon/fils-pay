/**
 * Parses a decimal string into an integer of minor units without floats.
 *
 * `decimals` is required on purpose. It used to default to 2, which is right
 * for cents and wrong for this codebase: money here is fils, 3 decimal
 * places (1 BD = 1000 fils). That default is how the adjustment importer came
 * to post a tenth of every amount. For BD amounts use `parseBhdToFils` from
 * @filspay/money instead of this.
 *
 * A fraction longer than `decimals` is rejected rather than truncated, so a
 * value can never silently lose precision.
 */
export function parseDecimalMinor(raw: string, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`parseDecimalMinor: decimals must be a non-negative integer, got ${decimals}`);
  }
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`parseDecimalMinor: not a decimal number: "${raw}"`);
  }

  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const dotIndex = abs.indexOf(".");
  const intPart = dotIndex === -1 ? abs : abs.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? "" : abs.slice(dotIndex + 1);
  if (fracPart.length > decimals) {
    throw new RangeError(`parseDecimalMinor: "${raw}" has more than ${decimals} decimal places`);
  }

  const value = Number(`${intPart}${fracPart.padEnd(decimals, "0")}`);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`parseDecimalMinor: "${raw}" exceeds the safe integer range`);
  }
  return negative ? -value : value;
}
