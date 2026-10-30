# FilsPay design: Carnival, Blush and Slate

The merchant dashboard, the public checkout and the FilsPay Ops console share
one design system with **three designs**, each in light and dark, chosen per
person in **Settings**. This is the reference for anyone adding a screen.

Inspired by three payment-app concepts in the brief (2026-10-30): a festival
poster of bold shapes, a soft pastel app with black pill buttons, and a calm
slate app with coral actions. It replaces the earlier "Ledger" design.

## The three designs

| | Carnival (default) | Blush | Slate |
|---|---|---|---|
| Feel | a festival poster | soft and editorial | calm and technical |
| Light page / card | lavender `#ECEAFB` / `#F8F7FF` | blush `#F6E3DF` / `#FFF8F5` | `#E6EAF1` / `#F5F7FA` |
| Dark page / card | indigo `#1F2672` / `#283090` | warm plum `#2B2127` / `#382B33` | slate `#26324D` / `#2F3D5C` |
| Sidebar | indigo panel, sun-yellow current page | blush panel, black current page | slate navy, coral current page |
| Primary button | indigo pill (sun yellow in dark) | black pill (blush in dark) | coral, 8px corners |
| Art colours | sun `#FFB42E`, rose `#FF3D68`, mint `#07C983`, peach | sand `#E6C49B`, rose, blush | coral `#FF6B6B`, sky `#6CB6FF`, gold |
| Display face | Unbounded | Bricolage Grotesque | Lexend |
| Illustration | geometric shapes: half-discs, a diamond, triangles | soft blobs and a sand card | a line chart and a dot grid |
| Backdrop | a fading dot grid in the top corner | a blush-to-peach wash | a fading dot grid |

**No dark mode is near-black.** Each is a coloured base that is clearly
lighter than `#121212` (a test checks it). Body text is Geist in every design;
the display face is for headings, amounts and the name. All fonts are
bundled from `@fontsource` (OFL) and only download when used.

**The one bold element per page** is the balance band on Overview: the
design's hero colour, the captured amount large, two actions and the design's
illustration (`components/art/DesignArt.tsx`). Sign-in panels and the
checkout summary use the same band colours and illustration. Everything else
stays quiet.

## Settings

Settings (`/dashboard/settings` in the dashboard, `/settings` in the Ops
console, also in Ctrl+K) holds the Appearance panel
(`components/kit/AppearanceSettings.tsx`), for every role:

| Choice | Options | On `<html>` |
|---|---|---|
| Design | Carnival, Blush, Slate | `data-design` |
| Light or dark | Light, Dark, Match my device | `data-theme="night"` in dark |
| Layout | Sidebar, Top bar | `data-layout="topbar"` |
| Spacing | Comfortable, Compact | `data-density="compact"` |
| Halloween costume | on / off | `data-costume="halloween"` |

Choices apply at once, are saved in this browser (`fp-appearance` in local
storage, read by `components/kit/theme.ts` before the first paint) and carry
over an older light/night choice. The sidebar's Light/Dark switch is a quick
shortcut to the same setting. **Top bar** turns the sidebar into one bar
across the top on wide screens (phones keep the drawer in both layouts);
**Compact** tightens the spacing grid and control heights.

## Tokens (`apps/*/src/theme.css`)

Components use only tokens, never raw colours, so every design and mode works
everywhere. Each design sets its tokens in `:root[data-design="…"]` and its
dark mode in `:root[data-design="…"][data-theme="night"]`.

| Group | Tokens | Notes |
|---|---|---|
| Neutrals | `--c-bg`, `--c-surface`, `--c-surface-2/3`, `--c-line`, `--c-line-2`, `--c-ink` … `--c-ink-4` | page, cards, rules and four text strengths |
| Action | `--c-primary`, `--c-primary-hover`, `--c-on-primary` | the primary button |
| Accent | `--c-accent`, `--c-accent-ink`, `--c-accent-soft` | focus, highlights, the BHD tag |
| Meaning | `--c-good`, `--c-warn`, `--c-danger` with `-soft` fills | status pills always pair a dot with a word |
| Sidebar | `--side-bg`, `--side-surface(-3)`, `--side-line`, `--side-ink(-2/-3)`, `--side-active-bg/-ink` | redefined inside the sidebar, so its contents follow |
| Band | `--hero-bg`, `--hero-ink(-2)`, `--hero-action-bg/-ink` | the balance band, sign-in panels, checkout summary |
| Art | `--art-1` … `--art-5` | the illustration's colours |
| Type | `--font-sans` Geist, `--font-display`, `--display-tracking`, `--display-weight`, `--font-mono` (IDs only) | |
| Shape | `--r-1` … `--r-4`, `--r-button`, `--shadow-xs/sm/pop` | larger radii for outer panels than for chips and fields |
| Space | `--sp-1` … `--sp-16`, `--control-h`, `--control-h-lg` | compact spacing changes these |

**Contrast is tested.** `apps/web/src/designTokens.test.ts` reads
`theme.css` and checks that every text-on-background pair (page, cards,
sidebar, band, statuses) reaches 4.5:1 in every design and mode, that dark
modes aren't near-black, and that the Ops console's copy of `theme.css` is
identical. `npm run e2e:a11y` then audits every page in all seven looks.

To add a design: add its two token blocks (the test lists what is required),
an illustration group in `DesignArt.tsx`, a preview in `AppearanceSettings.tsx`
and an entry in `DESIGNS` (`theme.ts`); the test will tell you what's missing.

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
- Focus is a visible outline in the design's colours. There is a skip link. Status is never shown by colour alone. Settings choices are real radio buttons, so they work with arrow keys and screen readers.
- Every animation stops under `prefers-reduced-motion`.
- Tab titles follow the page heading ("Transactions | FilsPay").

## Adding a screen

1. Start the page with its `<h1>`; the shell rules it off and the tab title follows it.
2. Wrap data in the existing classes (`dash-table`, `dash-dl`, `dash-filters`).
3. Use `Loading` / `EmptyState` / `ErrorBanner` rather than plain text.
4. Show money with `<Amount />`, and statuses with `statusLabel()` in a `dash-status dash-status-<status>` pill.
5. Use tokens, never raw colours, so every design, both modes and the costume all work.
