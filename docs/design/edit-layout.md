# Edit layout: the merchant's own order of the sidebar

The dashboard's sidebar has an **Edit layout** button (above Log out; also
in the search palette as "Edit layout"). It swaps the links for an editor
where the merchant can put them in any order:

- drag a row to where it should go, or
- use each row's ↑ and ↓ buttons, the keyboard and touch way. Focus stays
  on the row that moved, and a screen reader hears "Settings moved to
  position 1 of 7".

Every change is saved at once. **Reset** goes back to the default order, and
**Done** (or the Done editing button) closes the editor.

## What it does and doesn't change

- **Only the order.** The links, their addresses and who may see them don't
  change: `support` still doesn't get Reconciliation or Webhooks. A saved
  order can't show a link the role may not open, because only ids are
  stored and they are matched against the links that role is offered.
- **Section headings.** In the default order the links sit under their
  section headings (Payments, Money out, Developers, You), as before. A
  custom order is shown as a plain list, because the headings would only
  repeat and interrupt it.
- **Where it's saved.** The order is kept in this browser
  (`localStorage`, key `fp-nav-order`), like the appearance settings. On
  another browser or device the default order shows. If storage is blocked
  (a private window), the order still applies until the page is reloaded.
- **Hidden links.** The order covers every link, including ones the current
  role doesn't see, so a hidden link keeps its place if it comes back.
- **New links.** A link added in a later release, which the saved order
  doesn't know, goes after the known ones.
- **Layouts.** In the top-bar layout the editor drops down under the bar.
  On phones it sits in the slide-in drawer.

## Code

| What | Where |
|---|---|
| The rules: apply, move, save, load | `apps/web/src/components/nav/navOrder.ts` (+ `navOrder.test.ts`) |
| The links and who sees them | `apps/web/src/components/nav/SidebarNav.tsx` (`NAV_LINKS`, `visibleNavLinks`, + `visibleNavLinks.test.ts`) |
| The editor | `apps/web/src/components/nav/NavOrderEditor.tsx` |
| The button and wiring | `apps/web/src/components/DashboardLayout.tsx` |
| Styles | `apps/web/src/dashboard.css`, "Edit layout" |
| Browser check | `scripts/e2e/nav-layout-check.mjs` |

The browser check signs in as the seed's Alpha Retail owner and checks:

- moving with the arrows, with focus kept on the moved row, and the
  announcement;
- dragging;
- the new order in the sidebar, and that it survives a reload;
- Reset;
- the editor opening in the top-bar layout and in the phone drawer;
- no page errors.

```sh
# API with OTP_DEV_EXPOSE=true, dashboard on :5173
SHOTS=/tmp/shots node scripts/e2e/nav-layout-check.mjs
```
