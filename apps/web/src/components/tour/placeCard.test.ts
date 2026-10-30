import assert from "node:assert/strict";
import { test } from "node:test";
import { placeCard } from "./placeCard.js";

const card = { width: 320, height: 180 };
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 800 };

test("no target: centred", () => {
  assert.deepEqual(placeCard(null, card, desktop), { top: 310, left: 480, side: "center" });
});

test("a sidebar element gets the card on its right", () => {
  assert.deepEqual(placeCard({ top: 220, left: 14, width: 220, height: 300 }, card, desktop), { top: 220, left: 248, side: "right" });
});

test("near the bottom, the card is pulled up to stay on screen", () => {
  const p = placeCard({ top: 740, left: 14, width: 220, height: 40 }, card, desktop);
  assert.equal(p.side, "right");
  assert.equal(p.top, 800 - 180 - 12);
});

test("a full-width bar on a phone gets the card below, kept inside the window", () => {
  const p = placeCard({ top: 0, left: 0, width: 390, height: 56 }, card, phone);
  assert.deepEqual(p, { top: 70, left: 12, side: "bottom" });
});

test("an element at the bottom of a phone gets the card above", () => {
  const p = placeCard({ top: 700, left: 20, width: 350, height: 60 }, card, phone);
  assert.equal(p.side, "top");
  assert.equal(p.top, 700 - 14 - 180);
});

test("a huge element: the card floats at the bottom of the window", () => {
  const p = placeCard({ top: 0, left: 0, width: 1280, height: 800 }, card, desktop);
  assert.deepEqual(p, { top: 608, left: 480, side: "center" });
});
