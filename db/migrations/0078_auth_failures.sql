-- Failed sign-in attempts, for login throttling (docs/cyper/09-login-rate-limit.md).
--
-- One row per failed password check or wrong OTP code, merchant and admin.
-- Login counts recent rows for the account (and, when enabled, for the client
-- IP) and answers 429 once the limit is reached. Before this nothing limited
-- /login: passwords could be guessed without end, and every fresh login gave
-- a new OTP challenge with a new set of guesses.
--
-- account_key is sha256 of "merchant:<merchantId>:<email>" or
-- "admin:<email>", the same whether or not the account exists, so the limit
-- itself reveals nothing about which accounts are real. Rows older than the
-- window are only ever read past, never needed; the API prunes them.

CREATE TABLE auth_failures (
    id          BIGSERIAL PRIMARY KEY,
    plane       TEXT NOT NULL CHECK (plane IN ('merchant', 'admin')),
    kind        TEXT NOT NULL CHECK (kind IN ('password', 'otp')),
    account_key TEXT NOT NULL,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_failures_account ON auth_failures (account_key, created_at);
CREATE INDEX idx_auth_failures_ip ON auth_failures (ip_address, created_at);
