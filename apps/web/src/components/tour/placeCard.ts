/**
 * Where the tour's card goes next to the element it points at: to the right
 * if it fits (the sidebar's links), else below, else above, else left, and
 * always kept inside the window with a margin. Without a target it is
 * centred. Pure, so it is tested without a browser.
 */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CardPlacement {
  top: number;
  left: number;
  side: "right" | "bottom" | "top" | "left" | "center";
}

const GAP = 14;
const MARGIN = 12;

export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardPlacement {
  const clampLeft = (left: number) => Math.max(MARGIN, Math.min(viewport.width - card.width - MARGIN, left));
  const clampTop = (top: number) => Math.max(MARGIN, Math.min(viewport.height - card.height - MARGIN, top));

  if (!target) {
    return { top: clampTop((viewport.height - card.height) / 2), left: clampLeft((viewport.width - card.width) / 2), side: "center" };
  }
  const right = target.left + target.width + GAP;
  if (right + card.width + MARGIN <= viewport.width) {
    return { top: clampTop(target.top), left: right, side: "right" };
  }
  const below = target.top + target.height + GAP;
  if (below + card.height + MARGIN <= viewport.height) {
    return { top: below, left: clampLeft(target.left), side: "bottom" };
  }
  const above = target.top - GAP - card.height;
  if (above >= MARGIN) {
    return { top: above, left: clampLeft(target.left), side: "top" };
  }
  const left = target.left - GAP - card.width;
  if (left >= MARGIN) {
    return { top: clampTop(target.top), left, side: "left" };
  }
  // Nothing fits beside it (a big element on a small screen): float the card
  // at the bottom of the window, over the element.
  return { top: clampTop(viewport.height - card.height - MARGIN), left: clampLeft((viewport.width - card.width) / 2), side: "center" };
}
