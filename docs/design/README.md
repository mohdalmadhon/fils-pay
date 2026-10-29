# FilsPay design: pearl & tide

The merchant dashboard, the public checkout and the FilsPay Ops console share
one visual system. This is the reference for anyone adding a screen.

## The idea

Before oil, Bahrain's economy ran on pearls and the sea, and the fils is its
smallest coin. The interface is built from that world: deep Gulf water, the
cool sheen of nacre, a dhow on the horizon, and gold for money. It is used
in one bold place (the sea scenes on sign-in and checkout) and kept quiet
everywhere else, so the data stays the focus.

## Tokens (`apps/*/src/theme.css`)

| Name | Value | Used for |
|---|---|---|
| Abyss | `#0b2e35` | ink, merchant sidebar, sea scenes |
| Lagoon | `#147a78` | primary actions, focus, links |
| Nacre | `#eef3f1` | page background (a cool, sea-washed white) |
| Shell | `#ffffff` | cards, tables, inputs |
| Dinar gold | `#c79a2b` | money, the brand mark's shell, the Ops console's active state |
| Coral | `#c43d3d` | declines and errors |
| Night (Ops only) | `#081c26` | the admin console's sidebar and sign-in |

Outcome colours pair a strong ink with a soft fill: kelp (paid, active),
amber (pending, authorised), coral (failed, voided, expired), slate
(refunded, closed).

**Type:** Readex Pro, a typeface drawn for Gulf Arabic and Latin together,
from 200 to 700 weight, loaded from Google Fonts with the system UI font as
fallback. Tabular figures are on everywhere. The scale is 1.25 from a 16px
base (`--fp-step--1` to `--fp-step-5`).

**Amounts** use `<Amount fils={…} />`. Whole dinars are at full weight and the
three fils digits lighter, with BHD in gold, so `47.500` reads as dinars and
fils at a glance. Screen readers hear "47.500 BHD".

## Building blocks

| Piece | Where | Use it for |
|---|---|---|
| `Wordmark`, `BrandMark`, `Pearl` | `components/art/Art.tsx` | brand |
| `SeaScene` | same | sign-in and checkout side panels (animated tide, rising pearls, dhow) |
| `Scene name="…"` | same | spot illustrations: `empty`, `lost` (404), `locked` (not permitted, cancelled), `storm` (crash, network), `lowtide` (expired), `success` (paid), `waiting` (loading) |
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
- An unknown address shows the 404 page ("This page drifted off"), and a crash
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
- Touch targets are at least 42–44px. Focus is a visible lagoon ring. There
  is a skip-to-content link. Status is never shown by colour alone (every
  pill has its label).
- Every animation (tide, pearls, dhow, loading) stops under
  `prefers-reduced-motion`.
- Tab titles follow the page heading: "Transactions | FilsPay", "Merchants
  | FilsPay Ops".

## Adding a screen

1. Use the page's `<h1>` first; the shell styles it and the tab title follows it.
2. Wrap data in the existing classes (`dash-table`, `dash-dl`, `dash-filters`).
3. Use `Loading` / `EmptyState` / `ErrorBanner` rather than plain text.
4. Show money with `<Amount />` and statuses with `statusLabel()` in a
   `dash-status dash-status-<status>` pill.
