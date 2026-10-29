/**
 * Regression tests: adjustment import amounts are BD and must post as fils
 * (1 BD = 1000 fils). The parser used to treat them as cents, posting a tenth
 * of every amount. Pure — no database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDecimalMinor } from "../lib/decimal.js";
import { parsePromotionalDiscountFils } from "../payments/discountAdjustment.js";
import { parseAdjustmentAmountFils } from "./adjustmentCsvParsing.js";

test("BD amounts in every shape finance uses post the right number of fils", () => {
  assert.equal(parseAdjustmentAmountFils("4.75"), 4750);
  assert.equal(parseAdjustmentAmountFils("4.750"), 4750);
  assert.equal(parseAdjustmentAmountFils("120.00"), 120_000);
  assert.equal(parseAdjustmentAmountFils("120"), 120_000);
  assert.equal(parseAdjustmentAmountFils("0.001"), 1);
  assert.equal(parseAdjustmentAmountFils(" 4.5 "), 4500);
});

test("negative corrections keep their sign", () => {
  assert.equal(parseAdjustmentAmountFils("-1.250"), -1250);
  assert.equal(parseAdjustmentAmountFils("-0.5"), -500);
});

test("a fourth decimal is rejected, not silently truncated", () => {
  assert.throws(() => parseAdjustmentAmountFils("4.7555"), /could not parse amount/);
});

test("the third decimal is kept", () => {
  assert.equal(parseAdjustmentAmountFils("4.755"), 4755);
});

test("parseDecimalMinor has no cents default and never truncates", () => {
  assert.equal(parseDecimalMinor("4.75", 3), 4750);
  assert.equal(parseDecimalMinor("4.75", 2), 475);
  assert.throws(() => parseDecimalMinor("4.755", 2), /more than 2 decimal places/);
  // @ts-expect-error decimals is required
  assert.throws(() => parseDecimalMinor("4.75"), /decimals must be/);
});

test("promotional discounts are parsed as BD into fils, not cents", () => {
  assert.equal(parsePromotionalDiscountFils("2.5"), 2500);
  assert.equal(parsePromotionalDiscountFils("0.125"), 125);
  assert.throws(() => parsePromotionalDiscountFils("-1"), /invalid_discount|could not parse/);
  assert.throws(() => parsePromotionalDiscountFils("abc"), /could not parse/);
});
