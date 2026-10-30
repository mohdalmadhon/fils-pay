# FilsPay design: Ledger

The merchant dashboard, the public checkout and the FilsPay Ops console share
one design system. This is the reference for anyone adding a screen.

## The idea

FilsPay keeps the books for merchants in Bahrain down to the fils, the
smallest unit of the dinar. So the interface is set like a well-kept ledger:

- warm paper neutrals instead of cold grey
- ink-black actions
- tabular mono numerals for every amount
- hairline rules
- a single saffron accent that marks where you are and what moved

Colour is kept for meaning: status, focus and the current page. There is no
logo; the name is set as type. The sign-in screens show a ledger page (ruled
lines and a margin rule) with one figure on it: `0.001 BHD`, one fils.

## Tokens (`apps/*/src/theme.css`)

| Group | Tokens | Notes |
|---|---|---|
| Neutrals | `--c-bg`, `--c-surface`, `--c-surface-2/3`, `--c-line`, `--c-line-2`, `--c-ink` … `--c-ink-4` | parchment `#e9e5db` page, `#f3f0e8` cards, ink `#1c1a17`; night is navy `#070b14` |
| Action | `--c-primary`, `--c-primary-hover`, `--c-on-primary` | ink buttons; saffron in night |
| Accent | `--c-accent` `#d97a1e`, `--c-accent-ink`, `--c-accent-soft` | current page, focus, chart line, the BHD tag |
| Meaning | `--c-good`, `--c-warn`, `--c-danger` with `-soft` fills | status pills always pair a dot with a word |
| Type | `--font-sans` Geist, `--font-mono` Geist Mono, `--text-xs` … `--text-3xl` | 14px base; headings 22–28px, never oversized |
| Space | `--sp-1` … `--sp-16` | a 4px grid |
| Shape | `--r-1` 4px … `--r-4` 12px, `--shadow-xs/sm/pop` | small radii, hairline borders, shadows only on things that float |
| Motion | `--ease`, `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms | short and purposeful |
| Layout | `--sidebar-w`, `--content-max`, `--control-h` 36px, `--control-h-lg` 44px | |

There are three looks, all on the same tokens:

- **Light**, the default: warm parchment, never pure white, so the page
  doesn't glare. Cards `#F3F0E8` on a `#E9E5DB` page, ink actions, the
  saffron accent. Every text colour is at least 5:1 on the darkest surface.
- **Night** (`data-theme="night"` on `<html>`): the ledger at midnight. A deep
  navy (`#070B14` page, `#0D1320` to `#172033` surfaces) with saffron primary
  buttons. It has its own depth, in the "Night depth" section of `theme.css`:
  - a warm lamp glow and cool moonlight in opposite corners, with faint
    ledger ruling, fixed behind the page
  - a gradient sidebar with a saffron-to-blue hairline on its edge
  - cards, tables, filter panels and the overview tiles lit from the top
    with a highlight on their top edge
  - a glowing saffron marker on the current page, lit buttons that glow on
    hover, inset fields that light up on focus, and a midnight-blue card on
    checkout

  Toggled from the sidebar or the command palette. It is remembered per
  browser; otherwise it follows the system. These styles are scoped to night
  without the costume, which paints its own sky.
- **Halloween costume**: see below.

## Building blocks

| Piece | Where | Use it for |
|---|---|---|
| `Wordmark` | `components/art/Art.tsx` | the name as text (the Ops console adds an `OPS` tag) |
| `Scene name="…"` | same | small line illustrations: `empty`, `lost` (404), `locked`, `storm` (crash), `expired`, `success` (a check that draws itself), `waiting` (spinner) |
| `icons.*` | `components/art/Icons.tsx` | 24px line icons for navigation and actions |
| `Loading`, `EmptyState`, `ErrorBanner`, `StatePanel`, `Amount` | `components/ui.tsx` | every loading, empty, error and full-page state; amounts in BHD |
| `CommandPalette` | `components/kit/CommandPalette.tsx` | Ctrl+K / Cmd+K: jump to any page or run an action |
| `useTheme` | `components/kit/theme.ts` | light / night |
| `AreaChart`, `useCountUp` | `components/kit/` | overview chart (crosshair tooltip, keyboard arrows) and rolling totals |
| `HalloweenToggle` | `components/kit/Halloween.tsx` | the costume (below) |

Existing class names (`dash-*`, `admin-*`, `checkout-*`) are kept, so pages
pick up the system without changes:

- a form's submit button is the primary action
- tables and `<dl>`s become framed sheets
- `dash-status-*` become status pills

## Halloween costume

A jack-o'-lantern button (bottom right, or a tab on the right edge on phones)
dresses the whole site, both consoles and checkout, as a storybook Halloween
night. It is also in Settings and the Ctrl+K palette, and the choice is kept
per browser. It dresses whichever design is chosen: headings keep that
design's display face, lit pumpkin orange with a purple glow.

**Look.** Pumpkin orange `#FF7A1A`, witch purple `#B45CF0`, slime green
`#8FE36B` and candy yellow `#FFD23F` on a purple-black sky `#0C0814`, with
soft shadows and candlelight: buttons glow like a lantern, and the balance
band, sign-in panels and checkout summary turn a haunted purple with a
Halloween illustration (a moon, a haunted house on its hill, bats, a ghost
and two jack-o'-lanterns). Every text colour is at least 4.5:1, and
`npm run e2e:a11y` audits the costume.

**The art is vector SVG** (`components/kit/halloweenArt.tsx`), drawn with
gradients and glows:

| Piece | Where | Moves |
|---|---|---|
| Jack-o'-lantern | the button; the graveyard | the candle flickers through the carved face |
| Bat | flying | wings fold from the shoulder in a real flap; flees the pointer |
| Ghost | haunting | two hem frames for a wiggle; drifts on its own |
| Spider | on its thread | legs twitch; can be pulled down and springs back |
| Moon, clouds | top right | clouds drift slowly across the moon |
| Cobwebs | top corners | |
| Witch on a broom | across the sky | crosses every 24 seconds |
| `NightScene` | along the bottom, behind the page | a haunted house whose windows flicker, bare trees, an iron fence, RIP tombstones and crosses, and a black cat that blinks |

**Behind the page** (z-index -1, never over text or a click): stars that
twinkle, the witch, the night scene, glowing jack-o'-lanterns and soft fog.

**Over the page** (never takes a click, except the spider):

- bats wander and flee the pointer; touch one and it vanishes in a puff,
  and a counter keeps score
- the spider hangs on a thread and can be pulled down
- **the ghost haunts on its own**: it drifts slowly between random spots and
  every 9 to 16 seconds fades out and reappears elsewhere. It never follows
  the pointer. Touch it and it says boo, shakes and vanishes.

Under `prefers-reduced-motion` nothing moves and the witch stays home; the
rest of the scenery stays, still.

## Errors and empty states

- Every error says what happened and what to do next, without apologising.
- An unknown address shows the 404 page; a crash shows the error page with a reload button. Both apps use the router's `errorElement` and a `*` route.
- Empty tables say why they are empty ("No transactions match these filters.").
- Checkout has a state for every outcome: paid (receipt, with a print button), declined (the card shakes), expired, cancelled, already paid, in progress, not found.

## Responsive and accessible

- Over 900px: a fixed sidebar. Under 900px: a top bar, and the sidebar becomes a drawer that closes on navigation, Escape or a tap outside.
- Tables scroll sideways inside their own frame on narrow screens. Forms stack, and fields grow to 44px with 16px text so phones don't zoom.
- Focus is a visible saffron outline. There is a skip link. Status is never shown by colour alone.
- Every animation stops under `prefers-reduced-motion`.
- Tab titles follow the page heading ("Transactions | FilsPay").

## Adding a screen

1. Start the page with its `<h1>`; the shell rules it off and the tab title follows it.
2. Wrap data in the existing classes (`dash-table`, `dash-dl`, `dash-filters`).
3. Use `Loading` / `EmptyState` / `ErrorBanner` rather than plain text.
4. Show money with `<Amount />`, and statuses with `statusLabel()` in a `dash-status dash-status-<status>` pill.
5. Use tokens, never raw colours, so light, night and the costume all work.
