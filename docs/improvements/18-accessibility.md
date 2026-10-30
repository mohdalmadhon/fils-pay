# 18: Accessibility pass on the new design

| | |
|---|---|
| **Type** | Accessibility (WCAG 2.1 AA) |
| **Status** | Fixed (5 commits, not pushed). Checked automatically in CI from now on. |
| **Where found** | Measured with axe-core in Chromium on every dashboard page (light and night) and on the checkout page: **12 of 25 pages failed**. The findings, with where each was: |

| Finding | Severity | Where |
|---|---|---|
| **Amounts were read as nothing by screen readers.** `Amount` put `aria-label` on a plain `<span>` (screen readers ignore that on a generic element) and hid the digits with `aria-hidden`. This includes the total on the checkout page. | serious | `apps/web/src/components/ui.tsx:23-41`, `apps/admin/src/components/ui.tsx:22-40` |
| Muted text below the 4.5:1 contrast minimum: `--c-ink-3` `#75747b` measured 4.06 to 4.43:1 on the light surfaces. Affected the sidebar section labels, table metadata, checkout line labels and keyboard hints (47 elements). | serious | `apps/web/src/theme.css:28`, `apps/admin/src/theme.css:28` |
| The checkout page had no `h1`. The page's purpose, "Pay *merchant*", was a `<p>`. | moderate | `apps/web/src/pages/checkout/CheckoutPage.tsx:195` |
| An empty table header (`<th />`) on the overview's volume-bar column. | minor | `apps/web/src/pages/overview/OverviewPage.tsx:176` |
| **Not found by axe:** errors from detail-page actions (cancel a link, void, capture, refund) and load failures were plain `<p>` elements, so they were never announced. | — | `PaymentLinkDetailPage.tsx:92,166`, `TransactionDetailPage.tsx:135,183`, `SettlementBatchDetailPage.tsx:84`, `ReconciliationPage.tsx:73` |

## Fix

| # | Commit |
|---|---|
| 1 | `test: an accessibility check of every page, in both themes`: `scripts/e2e/a11y-check.mjs` (axe-core 4.11.0, pinned dev dependency), `npm run e2e:a11y`, CI step in the Browser end-to-end job. It failed on 12 of 25 pages. |
| 2 | `web: screen readers read amounts again`: the whole amount is visually hidden text (`.fp-visually-hidden`) beside the styled, `aria-hidden` digits |
| 3 | `web, admin: muted text meets 4.5:1 contrast`: `--c-ink-3` is now `#6b6a71`, which is 4.69:1 on the darkest light surface |
| 4 | `web, admin: page headings, table headers and announced errors`: the checkout `h1` (styled as before), the overview column header, `role="alert"` on the six error paragraphs, and the same `Amount` fix in the Ops console |
| 5 | `docs: improvement 18, accessibility` |

## Verified

- `npm run e2e:a11y`: **25 of 25 pages pass**. Before the fix, 13 of 25
  passed.
- The accessibility tree for the checkout total now reads
  `paragraph: 5.000 BHD`. Before, it was empty.
- The night theme already passed contrast (`#8b8b93` is at least 4.63:1).
  The Halloween costume's muted text (`#b5828c`, at least 4.89:1) was
  computed by hand here, and is audited automatically since
  [19](19-review-follow-ups.md): 39 of 39 pages, three looks.
- The checkout page looks the same as before in light and night
  (screenshot compared). In the Halloween costume the new h1 picked up the
  costume's gradient heading style; found in review and fixed in
  [19](19-review-follow-ups.md).
- `npm run e2e:browser` 11/11, web tests 10/10, `tsc` and `vite build` for
  both apps.

Checked by hand with a scripted keyboard, because axe can't judge these.
All were fine, so nothing was changed:

- **Checkout tab order.** Card number, month, year, CVV, Pay, the
  test-cards note. Every stop has a visible focus ring or outline.
- **Command palette (Ctrl K).** It opens with focus inside, Enter
  navigates, Escape closes, and focus returns to the button that opened
  it.
- **Reduced motion.** `prefers-reduced-motion` is respected
  (`theme.css`, `kit/motion.ts`).

## Not covered

- The Ops console pages are not in the automated check, because they need
  an admin sign-in. They share the design tokens and the `Amount` fix.
  Adding them would follow the same pattern.
- Nobody has tested with a real screen reader (NVDA, VoiceOver). That is
  worth doing before a public launch.
