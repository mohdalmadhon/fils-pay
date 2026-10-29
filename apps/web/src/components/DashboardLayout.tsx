import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import { Tide, Wordmark } from "./art/Art.js";
import { icons } from "./art/Icons.js";
import { ErrorBanner } from "./ui.js";

/** Nav shell for every merchant dashboard screen: a sea-dark sidebar on wide
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

  return (
    <div className="dash-shell" data-nav-open={navOpen}>
      <a className="fp-skip" href="#main">
        Skip to content
      </a>

      <header className="dash-topbar">
        <Wordmark />
        <button
          type="button"
          className="dash-menu-button"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="dash-sidebar"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? icons.close : icons.menu}
        </button>
      </header>

      <aside id="dash-sidebar" className="dash-sidebar" aria-label="Dashboard">
        <Wordmark />

        {me ? (
          <div className="dash-merchant">
            <span className="dash-merchant-name">{me.merchant.displayName}</span>
            <span className="dash-merchant-user">
              {me.email}
              <span className="dash-role-chip">{me.role}</span>
            </span>
          </div>
        ) : null}

        <nav className="dash-nav" aria-label="Main">
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
            <NavLink to="/dashboard/webhooks">
              {icons.webhooks}
              Webhooks
            </NavLink>
          </RequireRole>
        </nav>

        <div className="dash-sidebar-foot">
          <button type="button" className="dash-signout" onClick={() => void handleSignOut()}>
            {icons.logout}
            Log out
          </button>
          <Tide animated />
        </div>
      </aside>

      <div className="dash-scrim" onClick={() => setNavOpen(false)} aria-hidden />

      <div className="dash-content">
        <main id="main" className="dash-main" tabIndex={-1}>
          {error ? <ErrorBanner message={error} /> : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
