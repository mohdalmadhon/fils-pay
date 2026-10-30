import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPayoutTrends, getTopLinks, getVolumes } from "../../api/analytics.js";
import { describeError } from "../../api/client.js";
import { StalenessBadge } from "../../components/StalenessBadge.js";
import { bhd, dash, dateTime } from "../../format.js";
import { formatCount } from "../../utils/helpers.js";
import type { PayoutTrendsResponse, TopLinksResponse, VolumesResponse } from "../../types.js";
import { Amount, EmptyState, ErrorBanner } from "../../components/ui.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { AreaChart } from "../../components/kit/AreaChart.js";
import { useCountUp } from "../../components/kit/CountUp.js";
import { icons } from "../../components/art/Icons.js";
import { DesignArt } from "../../components/art/DesignArt.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { windowLabel } from "./windowLabel.js";

/** 60s: comfortably above the reporting worker's 15s worst-case lag, and
 *  more than often enough for a dashboard. Poll, not push —
 *  there is no websocket or SSE anywhere in this platform, and this page does
 *  not introduce the first one. */
const POLL_MS = 60_000;

export function OverviewPage() {
  // Left blank, the server applies its own "last 30 Asia/Bahrain days"
  // default — the client does not compute a competing one.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [topLinksLimit, setTopLinksLimit] = useState(10);

  const [volumes, setVolumes] = useState<VolumesResponse | null>(null);
  const [payouts, setPayouts] = useState<PayoutTrendsResponse | null>(null);
  const [topLinks, setTopLinks] = useState<TopLinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the server's own clamp so this page never displays a limit the
  // server would have silently overridden.
  const clampedLimit = Math.min(50, Math.max(1, Math.trunc(topLinksLimit) || 10));

  const load = useCallback(async () => {
    const range = { from: from || undefined, to: to || undefined };
    setLoading(true);
    setError(null);
    try {
      // Three independent endpoints, three independent fetches — there is no
      // combined route to call.
      const [v, p, t] = await Promise.all([
        getVolumes(range),
        getPayoutTrends(range),
        getTopLinks({ ...range, limit: clampedLimit }),
      ]);
      setVolumes(v);
      setPayouts(p);
      setTopLinks(t);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [from, to, clampedLimit]);

  // overview memory leak (heap +40mb/hr), pretty sure its these effects — am
  // FH: profiled for 1h, heap flat. maybe it was a browser extension? open
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const peakGross = Math.max(1, ...(volumes?.points.map((point) => point.capturedGrossFils) ?? [1]));

  const { me } = useDashboardAuth();
  const totals = {
    gross: volumes?.points.reduce((sum, p) => sum + p.capturedGrossFils, 0) ?? 0,
    count: volumes?.points.reduce((sum, p) => sum + p.capturedCount, 0) ?? 0,
    net: payouts?.points.reduce((sum, p) => sum + p.netPayoutFils, 0) ?? 0,
    topLink: topLinks?.links[0] ?? null,
  };
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section>
      <h1>Overview</h1>
      {/* The balance band: the one bold element on the page, in the
          design's hero colour with its own art. */}
      <div className="ov-hero">
        <div className="ov-hero-text">
          <p className="ov-hero-greeting">
            {greeting}
            {me ? `, ${me.merchant.displayName}` : ""}
          </p>
          <p className="ov-hero-label">
            Captured {volumes ? windowLabel(from, to) : "so far"}
          </p>
          <p className="ov-hero-amount">
            <RollingAmount fils={totals.gross} />
          </p>
          <div className="ov-hero-actions">
            <RequireRole allow={["owner", "finance"]}>
              <Link className="ov-hero-primary" to="/dashboard/payment-links/new">
                {icons.plus}
                Create a payment link
              </Link>
            </RequireRole>
            <Link className="ov-hero-secondary" to="/dashboard/transactions">
              See transactions
            </Link>
          </div>
        </div>
        <DesignArt className="ov-hero-art" />
      </div>

      <div className="ov-tiles">
        <Tile label="Payments captured" icon={icons.check}>
          <RollingCount value={totals.count} />
        </Tile>
        <Tile label="Net paid out" icon={icons.settlement}>
          <RollingAmount fils={totals.net} />
        </Tile>
        <Tile label="Top payment link" icon={icons.links}>
          {totals.topLink ? (
            <>
              <RollingAmount fils={totals.topLink.amountFils} />
              <span className="ov-tile-sub">{dash(totals.topLink.reference)}</span>
            </>
          ) : (
            <span className="ov-tile-none">None paid yet</span>
          )}
        </Tile>
      </div>

      <div className="ov-chart-card">
        <div className="ov-chart-head">
          <h2>Daily captured volume</h2>
          {volumes ? <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} /> : null}
        </div>
        {volumes && volumes.points.length > 0 ? (
          <AreaChart
            points={volumes.points.map((p) => ({ label: p.date, value: p.capturedGrossFils }))}
            format={(v) => bhd(v)}
            label={`Captured volume ${windowLabel(from, to)}, peaking at ${bhd(peakGross)}.`}
          />
        ) : (
          <EmptyState title={loading && !volumes ? "Loading volume" : "No captured volume in this window yet."}>
            Volume appears here once the reporting worker has counted your captures.
          </EmptyState>
        )}
      </div>

      <h2 className="ov-details-title">Details</h2>

      <form
        className="dash-form dash-form-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To (exclusive)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Top links
          <input
            type="number"
            min={1}
            max={50}
            value={topLinksLimit}
            onChange={(e) => setTopLinksLimit(Number(e.target.value))}
          />
        </label>
        <button type="submit" className="dash-button" disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </form>

      {error ? <ErrorBanner message={error} /> : null}

      <h2>
        Captured volume{" "}
        {volumes ? <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} /> : null}
      </h2>
      <table className="dash-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Captured</th>
            <th>Gross</th>
            <th>Voided</th>
            <th>
              <span className="fp-visually-hidden">Gross, as a share of the busiest day</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {volumes?.points.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{formatCount(point.capturedCount)}</td>
              <td>{bhd(point.capturedGrossFils)}</td>
              <td>{formatCount(point.voidedCount)}</td>
              <td className="dash-bar-cell">
                {/* A plain CSS bar, scaled to the window's own peak — no
                    charting library, no new dependency. */}
                <span
                  aria-hidden
                  className="dash-bar"
                  style={{ width: `${(point.capturedGrossFils / peakGross) * 100}%` }}
                />
              </td>
            </tr>
          ))}
          {volumes && volumes.points.length === 0 ? (
            <tr>
              <td colSpan={5} className="fp-empty-cell">
                <EmptyState title="No captured volume in this window." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2>
        Payout trends{" "}
        {payouts ? <StalenessBadge readModelAsOf={payouts.readModelAsOf} live={payouts.live} /> : null}
      </h2>
      <table className="dash-table">
        <thead>
          <tr>
            <th>Batch date</th>
            <th>Status</th>
            <th>Gross</th>
            <th>Fee</th>
            <th>Net payout</th>
            <th>Paid</th>
          </tr>
        </thead>
        <tbody>
          {payouts?.points.map((point) => (
            <tr key={point.settlementBatchId}>
              <td>
                <Link to={`/dashboard/settlement/${point.settlementBatchId}`}>{point.batchDate}</Link>
              </td>
              <td>{point.status}</td>
              <td>{bhd(point.grossFils)}</td>
              <td>{bhd(point.feeFils)}</td>
              <td>{bhd(point.netPayoutFils)}</td>
              <td>{dateTime(point.paidAt)}</td>
            </tr>
          ))}
          {payouts && payouts.points.length === 0 ? (
            <tr>
              <td colSpan={6} className="fp-empty-cell">
                <EmptyState title="No settled batches in this window." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2>
        Top paid links{" "}
        {topLinks ? (
          <StalenessBadge readModelAsOf={topLinks.readModelAsOf} live={topLinks.live} />
        ) : null}
      </h2>
      <table className="dash-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Reference</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Paid at</th>
          </tr>
        </thead>
        <tbody>
          {topLinks?.links.map((link, index) => (
            <tr key={link.id}>
              <td>{index + 1}</td>
              <td>
                <Link to={`/dashboard/payment-links/${link.id}`}>{dash(link.reference)}</Link>
              </td>
              <td>{dash(link.description)}</td>
              <td>{bhd(link.amountFils)}</td>
              <td>{dateTime(link.paidAt)}</td>
            </tr>
          ))}
          {topLinks && topLinks.links.length === 0 ? (
            <tr>
              <td colSpan={5} className="fp-empty-cell">
                <EmptyState title="No paid payment links in this window." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

function Tile({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ov-tile">
      <span className="ov-tile-label">
        {icon}
        {label}
      </span>
      <span className="ov-tile-value">{children}</span>
    </div>
  );
}

function RollingAmount({ fils }: { fils: number }) {
  return <Amount fils={useCountUp(fils)} />;
}

function RollingCount({ value }: { value: number }) {
  return <>{formatCount(useCountUp(value))}</>;
}
