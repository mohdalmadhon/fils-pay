# Take a tour: a skippable walkthrough of the dashboard

The dashboard's sidebar has a **Take a tour** button (also in the search
palette: type "tour"). It walks a merchant through the screen in a minute,
one element at a time:

1. **Welcome**, in the middle of the screen.
2. **Your pages**: the links.
3. **Search or jump anywhere**: the search box and Ctrl K / ⌘K.
4. **Where the work happens**: the main area.
5. **Put the links in your order**: Edit layout ([edit-layout.md](edit-layout.md)).
6. **Light or dark**: the theme switch, and where the other appearance
   choices are.
7. **That's it**: the tour button, to take it again.

Each step dims the page, outlines its element and shows a card with
**Back**, **Next** (**Finish** on the last step) and **Skip tour**.

## Skipping and coming back

- **Skip tour**, or **Escape**, ends it at once from any step. Nothing else
  needs answering first, and nothing is changed.
- The button shows a **New** mark until the person has finished or skipped
  the tour once in this browser (`localStorage`, key `fp-tour-seen`). The
  tour never starts by itself; it only runs when someone asks.
- It can be taken again at any time from the button or the palette.

## Who sees which steps

The steps are chosen when the tour starts, from what is on the screen for
that person. A step whose element isn't there is left out, so the tour
never points at nothing.

On a phone, the tour first opens the menu drawer so the sidebar's controls
can be shown, and leaves out the main-area step, because the drawer covers
it (6 steps instead of 7). In the top-bar layout, the card sits below the
bar.

## Accessibility

- The card is a modal dialog with a title and description.
- Focus moves to **Next** and stays inside the card when Tab is pressed.
- The left and right arrow keys step back and forward.
- Escape skips the tour.
- Focus returns to whatever opened the tour.
- The motion is turned off with `prefers-reduced-motion`.

## Code

| What | Where |
|---|---|
| Steps, next/back/skip, the seen flag | `apps/web/src/components/tour/tourSteps.ts` (+ `tourSteps.test.ts`) |
| Where the card goes | `apps/web/src/components/tour/placeCard.ts` (+ `placeCard.test.ts`) |
| The overlay and card | `apps/web/src/components/tour/Tour.tsx` |
| Button, palette command, `data-tour` targets | `apps/web/src/components/DashboardLayout.tsx`, `nav/SidebarNav.tsx` |
| Styles | `apps/web/src/dashboard.css`, "Take a tour" |
| Browser check | `scripts/e2e/tour-check.mjs` |

To add a step, give the element a `data-tour="name"` attribute and add
`{ id, target: "name", title, body }` to `DASHBOARD_TOUR` in the order it
should come.

The browser check covers:

- the New mark, and that it stays gone after a reload;
- Escape skipping, and focus going back to the button;
- every step outlining its element;
- Back, and Finish;
- starting from the palette;
- the top-bar layout;
- the phone (6 steps, card inside the screen);
- no page errors.

```sh
# API with OTP_DEV_EXPOSE=true, dashboard on :5173
SHOTS=/tmp/shots node scripts/e2e/tour-check.mjs
```
