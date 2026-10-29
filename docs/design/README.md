# FilsPay design: desert dusk

The merchant dashboard, the public checkout and the FilsPay Ops console share
one visual system. This is the reference for anyone adding a screen.

## The idea

The fils is Bahrain's smallest coin, and FilsPay counts every one. The
interface is set in the Gulf sky just after sunset: deep plum overhead,
dusty rose and apricot at the horizon, and sand gold for money. The art is a
small gallery of glossy 3D sculptures in that light: coins stacked on
pedestals, one coin floating inside a glowing ring, rose and apricot
spheres, a palm in a pot. It is used in one bold place (the dusk stage on
sign-in and checkout) and kept quiet everywhere else, so the data stays the
focus.

There is **no logo**. The product name is set as plain type (`Wordmark`),
no favicon is shipped, and the coins in the art carry no markings.

## Tokens (`apps/*/src/theme.css`)

| Name | Value | Used for |
|---|---|---|
| Plum | `#5b2a4e` | primary actions, links, merchant sidebar |
| Plum deep | `#3e1b36` | top of the dusk sky, dark ink on light |
| Dusty rose | `#d9777f` | focus ring, highlights, the floor of the stage |
| Apricot | `#e8a87c` | glows: the ring, the low sun, active nav |
| Sand gold | `#e0b15a` | money (the BHD tag), coins, the Ops console's active state |
| Page | `#fbf7f4` | page background (warm sand-white) |
| Surface | `#ffffff` | cards, tables, inputs |
| Midnight plum (Ops only) | `#24101f` | the admin console's sidebar and sign-in |

Outcome colours pair a strong ink with a soft fill: green (paid, active),
amber (pending, authorised), rose-red (failed, voided, expired), slate
(refunded, closed).

**Type:** Readex Pro, a typeface drawn for Gulf Arabic and Latin together,
from 200 to 700 weight, loaded from Google Fonts with the system UI font as
fallback. Tabular figures are on everywhere. The scale is 1.25 from a 16px
base (`--fp-step--1` to `--fp-step-5`).

**Amounts** use `<Amount fils={…} />`. Whole dinars are at full weight and the
three fils digits lighter, with BHD in sand gold, so `47.500` reads as dinars and
fils at a glance. Screen readers hear "47.500 BHD".

## Building blocks

| Piece | Where | Use it for |
|---|---|---|
| `Wordmark` | `components/art/Art.tsx` | the product name as text (no logo) |
| `StageScene` | same | sign-in and checkout side panels (pedestals, floating coin in its ring, pointer parallax) |
| `Coin`, `Orbs` | same | a single coin (card preview); soft glowing orbs (sidebar, standalone pages) |
| `Scene name="…"` | same | spot illustrations: `empty`, `lost` (404), `locked` (coin under glass: not permitted, cancelled), `storm` (toppled pedestal: crash, network), `expired` (hourglass), `success` (coin rising in its ring: paid), `waiting` (bouncing spheres: loading) |
| `icons.*` | `components/art/Icons.tsx` | navigation and actions, 24px line icons |
| `Loading`, `EmptyState`, `ErrorBanner`, `StatePanel` | `components/ui.tsx` | every loading, empty, error and full-page state |
| `statusLabel()` | same | "partially_captured" → "Partially captured" |
| `describeError()` | `api/client.ts` | turns API error codes into sentences; add new codes to `ERROR_MESSAGES` |

Existing class names (`dash-*`, `admin-*`, `checkout-*`) are kept, so pages
pick up the system without changes: a form's submit button is the primary
action, tables and `<dl>`s become cards, `dash-status-*` become pills.

## Errors and empty states

- Every error says what happened and what to do next, in the interface's
  voice, without apologising: "That code has expired. Start again to get a
  new one."
- An unknown address shows the 404 page ("This page rolled away"), and a crash
  shows the error page with a reload button instead of a blank screen. Both
  apps use the router's `errorElement` and a `*` route.
- Empty tables show the empty shell with the reason ("No transactions match
  these filters.").
- Checkout has a scene per outcome: paid (with receipt), declined, expired,
  cancelled, already paid, in progress, not found.

## Responsive and accessible

- Over 900px: fixed sidebar. Under 900px: top bar, and the sidebar becomes
  a drawer that closes on navigation, Escape or a tap outside.
- Tables scroll sideways inside their own card on narrow screens. Forms and
  filters stack to full width under 640px.
- Touch targets are at least 42–44px. Focus is a visible rose ring. There
  is a skip-to-content link. Status is never shown by colour alone (every
  pill has its label).
- Every animation (floating coin, parallax, orbs, loading) stops under
  `prefers-reduced-motion`.
- Tab titles follow the page heading: "Transactions | FilsPay", "Merchants
  | FilsPay Ops".

## Adding a screen

1. Use the page's `<h1>` first; the shell styles it and the tab title follows it.
2. Wrap data in the existing classes (`dash-table`, `dash-dl`, `dash-filters`).
3. Use `Loading` / `EmptyState` / `ErrorBanner` rather than plain text.
4. Show money with `<Amount />` and statuses with `statusLabel()` in a
   `dash-status dash-status-<status>` pill.
