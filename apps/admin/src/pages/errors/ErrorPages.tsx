import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router-dom";
import { Tide, Wordmark } from "../../components/art/Art.js";
import { StatePanel, usePageTitle } from "../../components/ui.js";

/** Frame for pages shown outside the dashboard shell: brand at the top,
 *  tide along the bottom. */
function StandaloneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fp-standalone">
      <header className="fp-standalone-head">
        <Link to="/merchants" className="fp-wordmark-link" aria-label="FilsPay Ops">
          <Wordmark />
        </Link>
      </header>
      <main id="main">{children}</main>
      <Tide className="fp-standalone-tide" animated />
    </div>
  );
}

/** Any address the app doesn't know. */
export function NotFoundPage() {
  const location = useLocation();
  usePageTitle("Page not found");
  return (
    <StandaloneFrame>
      <StatePanel
        scene="lost"
        code="404"
        title="This page drifted off"
        actions={
          <>
            <Link className="admin-button-primary" to="/merchants">
              Go to merchants
            </Link>
            <button type="button" onClick={() => window.history.back()}>
              Go back
            </button>
          </>
        }
      >
        <p>
          There&apos;s nothing at <code>{location.pathname}</code>. Check the address, or head back to
          the console.
        </p>
      </StatePanel>
    </StandaloneFrame>
  );
}

/** Router errorElement: a page threw while rendering or loading. Shows a
 *  way forward instead of a blank screen. */
export function RouteErrorPage() {
  const error = useRouteError();
  usePageTitle("Something went wrong");

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }

  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : null;

  return (
    <StandaloneFrame>
      <StatePanel
        scene="storm"
        code="Error"
        title="This page hit rough water"
        actions={
          <>
            <button type="button" className="admin-button-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            <Link className="admin-button" to="/merchants">
              Go to merchants
            </Link>
          </>
        }
      >
        <p>Something failed while showing this page. Your payments and data are not affected.</p>
        {detail ? (
          <details className="fp-error-detail">
            <summary>Technical details</summary>
            <code>{detail}</code>
          </details>
        ) : null}
      </StatePanel>
    </StandaloneFrame>
  );
}
