import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router-dom";
import { Wordmark } from "../../components/art/Art.js";
import { useCostume } from "../../components/kit/Halloween.js";
import { StatePanel, usePageTitle } from "../../components/ui.js";

/** Frame for pages shown outside the console shell: the name in a top bar,
 *  the state centred below. */
function StandaloneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fp-standalone">
      <header className="fp-standalone-head">
        <Link to="/dashboard" className="fp-wordmark-link" aria-label="FilsPay dashboard">
          <Wordmark />
        </Link>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}

/** Any address the app doesn't know. */
export function NotFoundPage() {
  const location = useLocation();
  const { on: costume } = useCostume();
  usePageTitle("Page not found");
  return (
    <StandaloneFrame>
      <StatePanel
        scene="lost"
        code="404"
        title={costume ? "This page has vanished into the night" : "We can\u2019t find that page"}
        actions={
          <>
            <Link className="dash-button dash-button-primary" to="/dashboard">
              Go to your dashboard
            </Link>
            <button type="button" className="dash-button" onClick={() => window.history.back()}>
              Go back
            </button>
          </>
        }
      >
        <p>
          There&apos;s nothing at <code>{location.pathname}</code>. Check the address, or head back to
          your dashboard.
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
        title="Something went wrong on this page"
        actions={
          <>
            <button type="button" className="dash-button dash-button-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            <Link className="dash-button" to="/dashboard">
              Go to your dashboard
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
