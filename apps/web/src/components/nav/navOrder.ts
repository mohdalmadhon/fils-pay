/**
 * The order of the dashboard's navigation links, as the merchant arranged it
 * with "Edit layout". Pure functions plus one small storage pair, so the
 * rules are testable without a browser.
 *
 * Only ids are stored. The links themselves (label, address, icon, who may
 * see them) live in the layout, so a stored order can never show a link
 * someone may not open: ids that aren't offered any more are dropped, and
 * new links the order doesn't know yet go after the known ones, in their
 * default position relative to each other.
 */

export const NAV_ORDER_KEY = "fp-nav-order";

/** The default order: the one the sidebar always had. */
export const DEFAULT_NAV_ORDER = [
  "overview",
  "transactions",
  "payment-links",
  "settlement",
  "reconciliation",
  "webhooks",
  "settings",
] as const;

export type NavId = (typeof DEFAULT_NAV_ORDER)[number];

export function isNavId(value: unknown): value is NavId {
  return typeof value === "string" && (DEFAULT_NAV_ORDER as readonly string[]).includes(value);
}

/**
 * The ids in `available` (in their default order), rearranged by `saved`.
 * Unknown and duplicate ids in `saved` are ignored; ids it leaves out keep
 * their default order after the ones it lists.
 */
export function applyNavOrder<T extends string>(available: readonly T[], saved: readonly string[] | null): T[] {
  if (!saved || saved.length === 0) return [...available];
  const offered = new Set<string>(available);
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const id of saved) {
    if (offered.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id as T);
    }
  }
  for (const id of available) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

/** `order` with `id` moved `delta` places (-1 up, +1 down), clamped to the ends. */
export function moveNavItem<T extends string>(order: readonly T[], id: T, delta: number): T[] {
  const from = order.indexOf(id);
  if (from === -1) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  return moveNavItemTo(order, id, to);
}

/** `order` with `id` placed at index `to` (drag and drop). */
export function moveNavItemTo<T extends string>(order: readonly T[], id: T, to: number): T[] {
  const from = order.indexOf(id);
  if (from === -1) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

/** True when `order` is the default order of the ids it holds. */
export function isDefaultNavOrder(order: readonly string[]): boolean {
  const defaults = (DEFAULT_NAV_ORDER as readonly string[]).filter((id) => order.includes(id));
  return defaults.length === order.length && defaults.every((id, i) => id === order[i]);
}

/** The saved order, or null. Storage can be missing or throw (private
 *  windows, blocked site data); that just means "default". */
export function loadNavOrder(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): NavId[] | null {
  try {
    const raw = storage?.getItem(NAV_ORDER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter(isNavId);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/** Saves `order`; the default order (or null) clears the saved one. */
export function saveNavOrder(
  order: readonly NavId[] | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  try {
    if (!order || isDefaultNavOrder(order)) storage?.removeItem(NAV_ORDER_KEY);
    else storage?.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Not saved; the order still applies until the page is reloaded.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
