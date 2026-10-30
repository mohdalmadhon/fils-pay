# AI in the design work

Branches `cyper` (Ledger design, Halloween costume, theme changes) and
`UI/UX` (the redesign), 29-30 October 2026. Results:
[`docs/design/README.md`](../../docs/design/README.md).

## What I asked, round by round

Design was the area where I steered most: each round I looked at the
result and said what to change.

| Round | My request (as written) | What came back |
|---|---|---|
| 1 | "can you edit the Halloween mode. make it more Halloween and dont make the ghost follow u and make it more pixeled" | a pixel-art costume: palette, pumpkin, bats, spider, moon; the ghost haunts on its own |
| 2 | "for the main theme. can you change I feel it is too bright. and the dark mode is too simple" | a softer parchment light theme and a richer night theme |
| 3 | "re-design the whole UI/UX. we need more colors. I want a whole another design and change the dark theme IT IS TOO DARK. and in the settings add multiple choices of the design and layout for the user to choose. and make the Halloween theme better by using more SVG. inspire from these" (four reference images) | three designs, each light and dark; Settings for design, light/dark, sidebar or top-bar layout and spacing; an SVG Halloween scene |
| 4 | "make the side bar better as components are over riding. and inspire from here [my Orbit app's components] for everything and make the dark mode dark. and change the colors" | the sidebar rebuilt; fields, detail lists, buttons and tabs after Orbit; darker tinted dark modes; new palettes |
| 5 | "take refrence from here but change the colors" (a neo-brutalist login card) | ink outlines, hard shadows and lifting buttons in all three designs |
| 6 | "continue but do not use purple." | the purple design replaced by Cobalt; no purple in any design |

Before building, the assistant asked when a choice was mine and a wrong
guess would be expensive: which branch the redesign goes on, whether to
rename the designs with their new colours, whether the brutalist look is a
fourth design or a restyle of all three.

## How the assistant worked

- **Colours as tokens, contrast as a test.** Every colour lives in
  `theme.css` as a token per design and mode, and
  `apps/web/src/designTokens.test.ts` checks every text and background pair
  at 4.5:1, outlines at 3:1, that dark modes are dark but tinted, and that
  the Ops console's copy is identical. A palette that fails doesn't ship.
- **Looked at every change.** Screenshots of every design, mode and page,
  dashboard and Ops console, signed in as the seed merchant
  ([`../scripts/screenshots.mjs`](../scripts/screenshots.mjs)), reviewed
  side by side as grids.
- **Accessibility in every look.** `npm run e2e:a11y` (axe-core) on every
  page in all seven looks (three designs in light and dark, plus the
  costume): 98 of 98 pages pass.
- **Settings tested like a person uses it**: click each choice, use the
  arrow keys, reload, check it stuck
  ([`../scripts/settings-check.mjs`](../scripts/settings-check.mjs)).
- **Fixed causes, not symptoms.** "Components are overriding" was a
  stylesheet order problem: the app stylesheets load after the shared
  theme, so equally specific rules there won. Shared rules are now anchored
  at `:root`, and the design doc says so for the next person.

## What it got wrong, and how that was caught

| Mistake | Caught by |
|---|---|
| Treated the Liter font as a serif with several weights; it is a sans with one weight | checking the installed font package, which ships one weight; the font stack and heading weight were corrected |
| Gradient button text below 4.5:1 at one end | the contrast test |
| Hard-coded greys in the sign-in panel; a purple costume wordmark too faint | the accessibility check |
| Its own new sidebar rules overridden by older ones; the search text wrapping onto two lines | the screenshots |
| The page colour hidden behind a white content area, and one design's band button the wrong colour (a CSS specificity slip) | the grid of all designs side by side |
| A Settings test that couldn't click the visually hidden radios | the test failing; it now clicks the cards and labels, as a person does |
| Used purple, which I didn't want | me ("do not use purple") |

## Read more

- The designs, tokens, components and how to add a design: [`docs/design/README.md`](../../docs/design/README.md)
- The accessibility pass: [`docs/improvements/18-accessibility.md`](../../docs/improvements/18-accessibility.md)
