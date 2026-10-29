-- Fencing token for payment-link pay attempts (incident 2026-05-14).
--
-- A pay attempt reserves a link for a short timeout. Before this column, a
-- reservation carried no owner: once the timeout passed, a second buyer could
-- take the link over while the first buyer's slow capture was still running,
-- and both were charged. The first attempt's release and finalize steps also
-- only checked `status = 'reserved'`, so they could act on the second buyer's
-- reservation.
--
-- Each attempt now writes a fresh random token here when it reserves the link,
-- and every later step (capture + finalize, or release) only acts while the
-- token is still its own. NULL whenever the link is not reserved.

ALTER TABLE payment_links
    ADD COLUMN reservation_token UUID;
