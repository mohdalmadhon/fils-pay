# FilsPay design: Orchid, Lagoon and Saffron

The merchant dashboard, the public checkout and the FilsPay Ops console share
one design system with **three designs**, each in light and dark, chosen per
person in **Settings**. Components follow Mohammed's Orbit app (its
`InputHolder` field, info list, sign-in tabs and gradient action button).
This is the reference for anyone adding a screen.

## The three designs

| | Orchid (default) | Lagoon | Saffron |
|---|---|---|---|
| Feel | bold and electric | cool, like the Gulf shallows | warm, like a spice market |
| Light page / card | lilac `#ECE8F4` / `#F7F5FB` | sea-glass `#E6F0F0` / `#F5FAFA` | parchment `#F3EBDD` / `#FBF6EE` |
| Dark page / card | violet-black `#0F0B18` / `#171226` | teal-black `#06171A` / `#0C2226` | espresso-black `#140F0A` / `#1D1710` |
| Ink and actions | violet `#6236C9` | teal `#0A6F6D` | burnt saffron `#A83F0C` |
| Highlight (current page, band action) | lime `#C6F04A` | aqua `#5FD3C6`, coral `#FF7A59` | marigold `#F2A51A` |
| Action gradient | violet to deep magenta | teal to deep sea-blue | burnt saffron |
| Display face | Liter (from Orbit) | Unbounded | Bricolage Grotesque |
| Illustration | geometric shapes | a line chart and a dot grid | soft blobs and a card |

The designs were renamed with their new colours (Carnival is now Orchid,
Slate is Lagoon, Blush is Saffron); a saved choice carries over.

**Dark modes are dark**: each page sits on a near-black tinted with its
design's colour, never flat grey (a test checks both). Body text is Geist;
small labels are **JetBrains Mono**; the display face is for headings, amounts
and the name. All fonts are bundled from `@fontsource` (OFL).

**The one bold element per page** is the balance band on Overview: the
design's hero colour, the captured amount large, two actions and the design's
illustration (`components/art/DesignArt.tsx`). Sign-in panels and the
checkout summary use the same band colours and illustration.

## Components (after Orbit)

| Piece | Look |
|---|---|
| Field | filled with a tint of the design (`--c-input`), no visible border until hovered, 7px corners (`--r-input`), 44px tall (40 compact); focus is the primary colour's border with a soft ring |
| Field label | small uppercase JetBrains Mono with letter spacing; checkbox and radio labels keep normal type |
| Fieldset title | a mono eyebrow in the primary colour |
| Details | Orbit's info list: mono labels beside values, a rule under each row; stacked on phones |
| Primary action | a 44px pill filled with the design's action gradient (`--action-from` to `--action-to`) |
| Tabs | underline tabs (Settings' light/dark, the sidebar's light/dark) |
| Filter checkbox | a filled toggle pill; the primary colour's border when on |

## The sidebar

One complete set of rules in `theme.css` for both apps, anchored at `:root`
so the older rules in `dashboard.css` and `admin.css` (which load after
`theme.css`) can't override parts of it. It has its own colours (`--side-*`),
darker than the page:

- a merchant card: avatar, the role as a mono eyebrow above the name, then
  the email (the "Owner" chip no longer squeezes them)
- an Orbit-style filled search field with the Ctrl K shortcut
- mono section labels and 40px rows; the current page is a solid pill in the
  design's highlight
- light/dark as underline tabs, then log out

When adding a shared component rule to `theme.css` that an app stylesheet
also styles, anchor it at `:root` (or raise its specificity), or the app
file's rule will win because it loads later.

## Settings

Settings (`/dashboard/settings` in the dashboard, `/settings` in the Ops
console, also in Ctrl+K) holds the Appearance panel
(`components/kit/AppearanceSettings.tsx`), for every role:

| Choice | Options | On `<html>` |
|---|---|---|
| Design | Orchid, Lagoon, Saffron | `data-design` |
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
| Type | `--font-sans` Geist, `--font-display`, `--font-meta` JetBrains Mono (labels), `--display-tracking`, `--display-weight`, `--font-mono` (IDs and digits) | |
| Fields and actions | `--c-input`, `--r-input`, `--action-from`, `--action-to`, `--gradient-action` | Orbit-style fields and the action gradient |
| Shape | `--r-1` … `--r-4`, `--r-button`, `--shadow-xs/sm/pop` | larger radii for outer panels than for chips and fields |
| Space | `--sp-1` … `--sp-16`, `--control-h`, `--control-h-lg` | compact spacing changes these |

**Contrast is tested.** `apps/web/src/designTokens.test.ts` reads
`theme.css` and checks that every text-on-background pair (page, cards,
sidebar, band, statuses, both ends of the action gradient) reaches 4.5:1 in
every design and mode, that dark modes are dark but tinted, and that the Ops
console's copy of `theme.css` is
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
