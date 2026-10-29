import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError, WEB_BASE_URL } from "../api/client.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { Orbs, Wordmark } from "./art/Art.js";
import { icons } from "./art/Icons.js";
import { ErrorBanner, StatePanel } from "./ui.js";
import { CommandPalette, useCommandPaletteShortcut, type Command } from "./fun/CommandPalette.js";
import { CoinPhysics, type CoinPhysicsHandle } from "./fun/CoinPhysics.js";
import { useTheme } from "./fun/theme.js";
import { useKonami } from "./fun/useKonami.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcutLabel = isMac ? "\u2318K" : "Ctrl K";

/** Nav shell for every admin-plane screen: a midnight-plum sidebar (drawer on
 *  phones) with who you are signed in as, the section links and log out,
 *  and above all of it the impersonation banner when a grant is live. */
// YA: nav order per Huda's request (Credits first)
export function AdminLayout() {
  const { admin, signOut, impersonation } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rain, setRain] = useState(0);
  const { theme, toggle: toggleTheme } = useTheme();
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);
  useKonami(() => setRain((n) => n + 1));

  const commands = useMemo<Command[]>(() => {
    const go = (id: string, label: string, to: string, icon: React.ReactNode, keywords?: string): Command => ({
      id,
      label,
      group: "Go to",
      icon,
      keywords,
      run: () => navigate(to),
    });
    return [
      go("merchants", "Merchants", "/merchants", icons.merchants, "onboarding kyc mdr"),
      go("credits", "Credits", "/credits", icons.credits, "grant adjust"),
      go("settlement", "Settlement ops", "/settlement", icons.settlement, "batches payouts"),
      go("imports", "Import adjustments", "/adjustment-imports", icons.imports, "csv upload"),
      go("webhooks", "Webhook replay", "/webhooks", icons.replay, "events deliveries"),
      {
        id: "theme",
        label: theme === "night" ? "Switch to dusk (light)" : "Switch to night (dark)",
        group: "Actions",
        icon: theme === "night" ? icons.sun : icons.moon,
        keywords: "theme dark light mode",
        run: toggleTheme,
      },
      { id: "rain", label: "Make it rain fils", group: "Actions", icon: icons.sparkle, keywords: "coins fun party", run: () => setRain((n) => n + 1) },
      { id: "logout", label: "Log out", group: "Actions", icon: icons.logout, keywords: "sign out exit", run: () => void handleSignOut() },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, toggleTheme, navigate]);

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

  // Tab title follows the page heading: "Merchants | FilsPay Ops".
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const sync = () => {
      const heading = main.querySelector("h1")?.textContent?.trim();
      document.title = heading ? `${heading} | FilsPay Ops` : "FilsPay Ops";
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
      navigate("/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="admin-shell" data-nav-open={navOpen}>
      <a className="fp-skip" href="#main">
        Skip to content
      </a>
      <ImpersonationBanner />

      <header className="admin-topbar">
        <Wordmark />
        <button type="button" className="admin-menu-button admin-topbar-search" aria-label="Search" onClick={openPalette}>
          {icons.search}
        </button>
        <button
          type="button"
          className="admin-menu-button"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="admin-sidebar"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? icons.close : icons.menu}
        </button>
      </header>

      <aside id="admin-sidebar" className="admin-sidebar" aria-label="Operations console">
        <Wordmark />
        {admin ? (
          <div className="admin-identity">
            <strong>{admin.email}</strong>
            <span className="admin-role-chip">{admin.role.replace("_", " ")}</span>
          </div>
        ) : null}

        <button type="button" className="fp-nav-search" onClick={openPalette}>
          {icons.search}
          <span>Jump to…</span>
          <kbd className="fp-kbd">{shortcutLabel}</kbd>
        </button>

        <nav className="admin-nav" aria-label="Main">
          <NavLink to="/merchants">
            {icons.merchants}
            Merchants
          </NavLink>
          <NavLink to="/credits">
            {icons.credits}
            Credits
          </NavLink>
          <NavLink to="/settlement">
            {icons.settlement}
            Settlement ops
          </NavLink>
          <NavLink to="/adjustment-imports">
            {icons.imports}
            Import adjustments
          </NavLink>
          <NavLink to="/webhooks">
            {icons.replay}
            Webhook replay
          </NavLink>
        </nav>

        <div className="admin-sidebar-foot">
          <button
            type="button"
            className="fp-theme-switch"
            aria-pressed={theme === "night"}
            onClick={toggleTheme}
            title="Switch between dusk and night"
          >
            <span className="fp-theme-switch-track" aria-hidden>
              <span className="fp-theme-switch-knob">{theme === "night" ? icons.moon : icons.sun}</span>
            </span>
            {theme === "night" ? "Night" : "Dusk"}
          </button>
          <button type="button" className="admin-signout" onClick={() => void handleSignOut()}>
            {icons.logout}
            Log out
          </button>
          <Orbs />
        </div>
      </aside>

      <div className="admin-scrim" onClick={() => setNavOpen(false)} aria-hidden />

      <div className="admin-content">
        {impersonation ? (
          // An explicit "exit view-as-merchant" action is required before
          // admin-plane screens are shown again. This is a UX safeguard so the
          // two modes are never confused on screen; the privilege boundary
          // itself does not depend on it: /v1/admin/* never reads the
          // impersonation cookie, and the merchant side never reads the admin
          // session cookie.
          <main id="main" className="admin-main" tabIndex={-1}>
            <StatePanel scene="locked" code="Viewing as a merchant" title="Admin screens are paused">
              <p>
                You&apos;re viewing a merchant&apos;s dashboard. Use <strong>Exit impersonation</strong>{" "}
                in the red bar to end it and come back here.
              </p>
              <p>
                The merchant&apos;s screens are at <a href={`${WEB_BASE_URL}/dashboard`}>{WEB_BASE_URL}</a>{" "}
                while the grant lasts.
              </p>
            </StatePanel>
          </main>
        ) : (
          <main id="main" className="admin-main" tabIndex={-1}>
            {error ? <ErrorBanner message={error} /> : null}
            <div key={location.pathname} className="fp-page-enter">
              <Outlet />
            </div>
          </main>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      {rain ? <FilsRain key={rain} onDone={() => setRain(0)} /> : null}
    </div>
  );
}

/** The Konami reward: it rains fils for a few seconds. */
function FilsRain({ onDone }: { onDone: () => void }) {
  const coins = useRef<CoinPhysicsHandle>(null);
  useEffect(() => {
    const drops = [0, 200, 400, 600, 800].map((delay) => window.setTimeout(() => coins.current?.drop(14), delay));
    const done = window.setTimeout(onDone, 7000);
    return () => {
      drops.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(done);
    };
  }, [onDone]);
  return (
    <div className="fp-shower" aria-hidden>
      <CoinPhysics ref={coins} maxCoins={90} />
    </div>
  );
}
