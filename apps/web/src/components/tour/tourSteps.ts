/**
 * The dashboard tour ("Take a tour"): its steps and the rules for moving
 * through them. Pure, so it is testable without a browser.
 *
 * A step points at an element by its `data-tour` attribute. Steps whose
 * element isn't on the page for this person (a link their role doesn't
 * see, say) are left out when the tour starts, so it never points at
 * nothing. A step with no target is shown in the middle of the screen.
 */

export const TOUR_SEEN_KEY = "fp-tour-seen";

export interface TourStep {
  id: string;
  /** Matches `data-tour="..."` on the element to point at; none = centred. */
  target?: string;
  title: string;
  body: string;
}

export const DASHBOARD_TOUR: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to your FilsPay dashboard",
    body: "A quick look around: about a minute. You can skip at any time, and take the tour again from the sidebar.",
  },
  {
    id: "nav",
    target: "nav",
    title: "Your pages",
    body: "Overview for the big picture, Transactions for every payment, Payment links to get paid without a website, Settlement for what's paid out to you.",
  },
  {
    id: "search",
    target: "search",
    title: "Search or jump anywhere",
    body: "Open it with Ctrl K (⌘K on a Mac), type a page or an action, press Enter.",
  },
  {
    id: "main",
    target: "main",
    title: "Where the work happens",
    body: "Each page opens here. Lists can be filtered, and amounts are always in BHD with three decimals.",
  },
  {
    id: "edit-layout",
    target: "edit-layout",
    title: "Put the links in your order",
    body: "Edit layout lets you drag the sidebar links, or move them with the arrows, into the order you use them.",
  },
  {
    id: "theme",
    target: "theme",
    title: "Light or dark",
    body: "Switch here. More choices (three designs, top bar or sidebar, compact spacing) are in Settings.",
  },
  {
    id: "tour",
    target: "tour",
    title: "That's it",
    body: "Take the tour again from here whenever you like.",
  },
];

/** The steps whose element exists (or that need none), in order. */
export function availableSteps(steps: readonly TourStep[], exists: (target: string) => boolean): TourStep[] {
  return steps.filter((step) => !step.target || exists(step.target));
}

export type TourAction = "next" | "back" | "skip";

/** The step index after an action, or null when the tour is over. */
export function nextTourIndex(index: number, count: number, action: TourAction): number | null {
  if (action === "skip") return null;
  if (action === "back") return Math.max(0, index - 1);
  return index + 1 >= count ? null : index + 1;
}

/** "Step 2 of 7". */
export function tourProgress(index: number, count: number): string {
  return `Step ${index + 1} of ${count}`;
}

/** Whether this browser has finished or skipped the tour before. Storage
 *  can be missing or throw; then the answer is "no". */
export function hasSeenTour(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Not remembered; the "New" mark just shows again next time.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
