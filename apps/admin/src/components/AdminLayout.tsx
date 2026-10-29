import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError, WEB_BASE_URL } from "../api/client.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { Orbs, Wordmark } from "./art/Art.js";
import { icons } from "./art/Icons.js";
import { ErrorBanner, StatePanel } from "./ui.js";

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
            <Outlet />
          </main>
        )}
      </div>
    </div>
  );
}
