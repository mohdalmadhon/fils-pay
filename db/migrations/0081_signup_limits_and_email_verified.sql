-- Signup limits and email ownership (docs/improvements/11).
--
-- signup_attempts: one row per accepted signup, keyed by a hash of the
-- lower-cased owner email (and the client IP, for the optional per-IP
-- limit). POST /v1/merchants counts recent rows before creating a merchant.
-- Signup is public and needed no proof of the email, so one address could
-- open merchants without limit.
--
-- merchant_users.email_verified_at: set the first time the user completes
-- an OTP login. The OTP goes to that address, so finishing it proves the
-- user controls it. NULL for accounts that have never logged in.

CREATE TABLE signup_attempts (
    id         BIGSERIAL PRIMARY KEY,
    email_key  TEXT NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_signup_attempts_email ON signup_attempts (email_key, created_at);
CREATE INDEX idx_signup_attempts_ip ON signup_attempts (ip_address, created_at);

ALTER TABLE merchant_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
