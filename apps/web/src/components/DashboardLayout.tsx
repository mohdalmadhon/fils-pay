import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import { Wordmark } from "./art/Art.js";
import { icons } from "./art/Icons.js";
import { ErrorBanner } from "./ui.js";
import { CommandPalette, useCommandPaletteShortcut, type Command } from "./kit/CommandPalette.js";
import { useTheme } from "./kit/theme.js";
import { useCostume } from "./kit/Halloween.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcutLabel = isMac ? "⌘K" : "Ctrl K";

/** Nav shell for every merchant dashboard screen: a quiet sidebar on wide
 *  screens, a top bar with a slide-in drawer on phones. No impersonation
 *  banner here: nothing in the merchant plane impersonates anyone; when an
 *  admin "views as merchant", they arrive with a `support`-role session and
 *  see exactly what a support user sees. */
export function DashboardLayout() {
  const { me, signOut } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, setTheme, toggle: toggleTheme } = useTheme();
  const { on: costume, toggle: toggleCostume } = useCostume();
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

  // Close the drawer whenever the page changes, and on Escape.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Tab title follows the page's own heading ("Transactions | FilsPay"),
  // including headings that appear once a detail page has loaded.
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const sync = () => {
      const heading = main.querySelector("h1")?.textContent?.trim();
      document.title = heading ? `${heading} | FilsPay` : "FilsPay";
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  const canSeeFinance = !me || me.role === "owner" || me.role === "finance";
  const commands = useMemo<Command[]>(() => {
    const go = (id: string, label: string, to: string, icon: React.ReactNode, keywords?: string): Command => ({
      id,
      label,
      group: "Go to",
      icon,
      keywords,
      run: () => navigate(to),
    });
    const list: Command[] = [
      go("overview", "Overview", "/dashboard/overview", icons.overview, "home stats volume charts"),
      go("transactions", "Transactions", "/dashboard/transactions", icons.transactions, "payments captures refunds"),
      go("links", "Payment links", "/dashboard/payment-links", icons.links, "invoices"),
      go("settlement", "Settlement", "/dashboard/settlement", icons.settlement, "payouts batches"),
    ];
    if (canSeeFinance) {
      list.push(go("reconciliation", "Reconciliation", "/dashboard/reconciliation", icons.reconciliation, "matching"));
      list.push(go("webhooks", "Webhooks", "/dashboard/webhooks", icons.webhooks, "endpoints events"));
      list.push({ id: "new-link", label: "Create a payment link", group: "Actions", icon: icons.plus, keywords: "new invoice", run: () => navigate("/dashboard/payment-links/new") });
    }
    list.push(
      go("settings", "Settings", "/dashboard/settings", icons.settings, "appearance design theme layout compact cobalt lagoon saffron"),
      {
        id: "theme",
        label: theme === "night" ? "Switch to light mode" : "Switch to dark mode",
        group: "Actions",
        icon: theme === "night" ? icons.sun : icons.moon,
        keywords: "theme dark light mode",
        run: toggleTheme,
      },
      {
        id: "costume",
        label: costume ? "Take off the Halloween costume" : "Put on the Halloween costume",
        group: "Actions",
        icon: icons.sparkle,
        keywords: "halloween spooky pumpkin costume",
        run: () => toggleCostume(),
      },
      { id: "logout", label: "Log out", group: "Actions", icon: icons.logout, keywords: "sign out exit", run: () => void handleSignOut() },
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeFinance, theme, toggleTheme, costume, toggleCostume, navigate]);

  return (
    <div className="dash-shell" data-nav-open={navOpen}>
      <a className="fp-skip" href="#main">
        Skip to content
      </a>

      <header className="dash-topbar">
        <Wordmark />
        <button type="button" className="dash-icon-button dash-topbar-search" aria-label="Search" onClick={openPalette}>
          {icons.search}
        </button>
        <button
          type="button"
          className="dash-icon-button"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="dash-sidebar"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? icons.close : icons.menu}
        </button>
      </header>

      <aside id="dash-sidebar" className="dash-sidebar" aria-label="Dashboard">
        <div className="dash-sidebar-head">
          <Wordmark />
        </div>

        {me ? (
          <div className="dash-merchant">
            <span className="dash-merchant-avatar" aria-hidden>
              {me.merchant.displayName.trim().charAt(0).toUpperCase()}
            </span>
            <span className="dash-merchant-text">
              <span className="dash-merchant-name">{me.merchant.displayName}</span>
              <span className="dash-merchant-user">{me.email}</span>
            </span>
            <span className="dash-role-chip">{me.role}</span>
          </div>
        ) : null}

        <button type="button" className="fp-nav-search" onClick={openPalette}>
          {icons.search}
          <span>Search or jump to…</span>
          <kbd className="fp-kbd">{shortcutLabel}</kbd>
        </button>

        <nav className="dash-nav" aria-label="Main">
          <span className="dash-nav-label">Payments</span>
          <NavLink to="/dashboard/overview">
            {icons.overview}
            Overview
          </NavLink>
          <NavLink to="/dashboard/transactions">
            {icons.transactions}
            Transactions
          </NavLink>
          <NavLink to="/dashboard/payment-links">
            {icons.links}
            Payment links
          </NavLink>
          <span className="dash-nav-label">Money out</span>
          <NavLink to="/dashboard/settlement">
            {icons.settlement}
            Settlement
          </NavLink>
          {/* Webhooks and reconciliation are owner/finance-only server-side,
              so the links are hidden from support rather than offered and
              then refused. */}
          <RequireRole allow={["owner", "finance"]}>
            <NavLink to="/dashboard/reconciliation">
              {icons.reconciliation}
              Reconciliation
            </NavLink>
          </RequireRole>
          <RequireRole allow={["owner", "finance"]}>
            <span className="dash-nav-label">Developers</span>
            <NavLink to="/dashboard/webhooks">
              {icons.webhooks}
              Webhooks
            </NavLink>
          </RequireRole>
          <span className="dash-nav-label">You</span>
          <NavLink to="/dashboard/settings">
            {icons.settings}
            Settings
          </NavLink>
        </nav>

        <div className="dash-sidebar-foot">
          <div className="fp-segment" role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
              {icons.sun}
              Light
            </button>
            <button type="button" aria-pressed={theme === "night"} onClick={() => setTheme("night")}>
              {icons.moon}
              Dark
            </button>
          </div>
          <button type="button" className="dash-signout" onClick={() => void handleSignOut()}>
            {icons.logout}
            Log out
          </button>
        </div>
      </aside>

      <div className="dash-scrim" onClick={() => setNavOpen(false)} aria-hidden />

      <div className="dash-content">
        <main id="main" className="dash-main" tabIndex={-1}>
          {error ? <ErrorBanner message={error} /> : null}
          {/* Re-keyed per page so each one settles in. */}
          <div key={location.pathname} className="fp-page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
