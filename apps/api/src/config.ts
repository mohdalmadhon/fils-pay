/**
 * App-wide configuration, loaded once from environment variables at boot.
 * `loadConfig` throws synchronously — crashing boot rather than serving
 * traffic in a half-configured state — if `DATABASE_URL` is missing, or if
 * `SETTLEMENT_INTERNAL_TOKEN` is missing while `nodeEnv === 'production'`.
 *
 * Later sub-phases add their own fields to this same interface/loader
 * rather than introducing a second config system.
 */
export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;

  pgPoolMax: number;
  /** Load shedding (plugins/overloadGuard.ts): in-flight request limit; 0 turns it off. */
  overloadMaxInFlight: number;
  /** Shed while the event loop's p99 delay is above this (ms); 0 ignores it. */
  overloadMaxEventLoopDelayMs: number;
  /** Shed while this many requests wait for a database connection; 0 ignores it. */
  overloadMaxPoolWaiting: number;
  pgPoolMin: number;
  pgPoolIdleTimeoutMs: number;
  pgPoolConnectionTimeoutMs: number;

  sessionTtlHours: number;
  pendingSessionTtlMinutes: number;
  otpTtlMinutes: number;
  otpCodeLength: number;
  otpMaxAttempts: number;
  otpDevExpose: boolean;
  /** Explicit demo-only screen display; independent of development logging. */
  otpDemoDisplay?: boolean;
  /** Optional operator-only OTP delivery file; never returned by the API. */
  otpLogFile?: string;
  /** Failed password/OTP attempts per account within the window before
   *  login answers 429 (auth/throttle.ts). */
  loginMaxFailures: number;
  /** Same, per client IP; 0 (the default) turns the IP limit off. Turn it
   *  on only with TRUST_PROXY set correctly behind a load balancer. */
  loginMaxFailuresPerIp: number;
  loginFailureWindowMinutes: number;
  /** Merchants one owner email may open per window (onboarding/signupLimits.ts). */
  signupMaxPerEmail: number;
  /** Signups per client IP per window; 0 (default) = off. Needs TRUST_PROXY. */
  signupMaxPerIp: number;
  signupWindowMinutes: number;
  /** Fastify trustProxy: false (default, request.ip is the socket peer),
   *  true, or a comma list of proxy addresses/CIDRs (preferred over true). Set it to
   *  the load balancer when there is one, or every request.ip (audit rows,
   *  the per-IP login limit) is the balancer's address. */
  trustProxy: boolean | string;

  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;

  kycUploadDir: string;
  kycMaxFileSizeBytes: number;

  acquirerLatencyMinMs: number;
  acquirerLatencyMaxMs: number;
  acquirerFailureRate: number;
  acquirerRngSeed: number | null;

  cookieName: string;
  cookieSecure: boolean;

  /** Browser origins allowed to call this API with credentials (CORS):
   *  the merchant dashboard and the admin console. CORS_ALLOWED_ORIGINS,
   *  comma-separated. Defaults to the two local dev servers outside
   *  production, and to none in production, where it must be set. */
  corsAllowedOrigins: string[];

  /** Cookie carrying an `admin_sessions` token. A completely separate name,
   *  table, and code path from `cookieName`/`sessions` — `requireAdminSession`
   *  reads only this one and `requireMerchantAuth` never reads it at all, so
   *  an admin session can never be resolved as merchant authority. */
  adminCookieName: string;
  /** Deliberately shorter than a merchant session's 12h — a minor extra
   *  caution for the higher-privilege plane. */
  adminSessionTtlHours: number;
  adminPendingSessionTtlMinutes: number;
  adminOtpTtlMinutes: number;
  adminOtpCodeLength: number;
  adminOtpMaxAttempts: number;

  /** Cookie carrying an `admin_impersonation_grants` token — the third,
   *  distinct cookie in the system. Read only by `requireMerchantAuth`, and
   *  never by `requireAdminSession`: the privilege drop is structural, not a
   *  flag that could fail to be cleared. */
  impersonationCookieName: string;
  /** Bounded lifetime of a "view as merchant" grant. Checked on every
   *  lookup — there is no "until logout" path. */
  impersonationTtlMinutes: number;
  /** Largest adjustment-import request body accepted, in bytes (the CSV is sent as JSON). */
  adjustmentImportMaxBytes: number;
  /** Most data rows one adjustment import may contain; larger files are split. */
  adjustmentImportMaxRows: number;

  /** Base URL of apps/settlement's internal HTTP server, reachable only
   *  inside the compose network. The API delegates settlement operations
   *  (batch runs, balance refreshes) through this. */
  settlementInternalUrl: string;
  /** Bearer token for that internal server. Required in production, same
   *  posture the retired `internalApiToken` had. */
  settlementInternalToken: string;
  /** Timeout for an internal settlement call. Generous on purpose: a full
   *  daily batch across every merchant genuinely takes longer than a typical
   *  API-latency budget. */
  settlementInternalRequestTimeoutMs: number;

  /** Base URL of apps/web's hosted checkout, used only to build the
   *  convenience `url` field on a created payment link — the API itself
   *  has no other reason to know where apps/web is hosted, and no route
   *  redirects there. Default matches Vite's own default dev port. */
  checkoutBaseUrl: string;
  /** How long a payment link stays 'reserved' (claimed by an in-flight pay
   *  attempt) before it self-expires back to claimable, closing the gap
   *  between claim and finalize without a sweep job. */
  paymentLinkReservationTimeoutSeconds: number;

  /** Base64-encoded 32 raw bytes, the single application-level AES-256-GCM
   *  key `webhooks/secretCrypto.ts` uses to encrypt/decrypt
   *  `webhook_endpoints.secret_ciphertext`. Required in every environment
   *  (not just production) — the platform must be able to actually encrypt
   *  and later recover a webhook secret's plaintext at send time, so there
   *  is no "dev doesn't need this" story the way there is for
   *  `settlementInternalToken`. `loadConfig` decodes and validates the length,
   *  failing boot on a missing or malformed value rather than accepting
   *  garbage and failing later at first-delivery time. Callers pass
   *  `Buffer.from(config.webhookSecretEncryptionKey, "base64")` to
   *  `encryptSecret`/`decryptSecret`, which take a `Buffer` key. */
  webhookSecretEncryptionKey: string;
  /** Terminal-failure threshold for a single webhook_deliveries row — the
   *  attempt at which status flips from 'pending' to 'exhausted' instead of
   *  scheduling another retry. */
  webhookMaxAttempts: number;
  /** Exponential backoff base (attempt 1's delay), milliseconds. */
  webhookBackoffBaseMs: number;
  /** Exponential backoff cap — no retry ever waits longer than this,
   *  milliseconds. */
  webhookBackoffCapMs: number;
  /** How often the dispatcher's poll-fallback timer runs a dispatch pass,
   *  independent of LISTEN/NOTIFY — the safety net that guarantees no event
   *  is stuck forever even if a NOTIFY is missed. */
  webhookPollIntervalMs: number;
  /** Per-delivery-attempt HTTP timeout passed to the transport, milliseconds. */
  webhookRequestTimeoutMs: number;
  /** Deliver webhooks to loopback/private/link-local addresses. Defaults to
   *  true outside production (local receivers), false in production; and it
   *  is a boot error to turn it on in production. */
  webhookAllowPrivateHosts: boolean;

  /** Shared secret the acquirer signs its async callbacks with
   *  (routes/acquirerCallbacks.ts). Platform-level, not per-merchant —
   *  unlike webhookSecretEncryptionKey, there is exactly one acquirer
   *  relationship, not one secret per registered endpoint. */
  acquirerCallbackSigningSecret: string;
  /** Reject acquirer callbacks that carry no signature. Defaults to true and
   *  is always true in production; only a non-production environment may
   *  opt out with ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=false. */
  acquirerCallbackRequireSignature: boolean;
  /** How far a callback's signed `t=` timestamp may be from the server
   *  clock, in seconds, before it is rejected as stale or replayed. */
  acquirerCallbackToleranceSeconds: number;
}

/** Unset means development (local runs). Any other value must be one of the
 *  three exact names: a typo like "prod" or a name like "staging" must not
 *  silently boot with development defaults on a hosted box. */
function parseNodeEnv(value: string | undefined): Config["nodeEnv"] {
  if (value === undefined || value === "") return "development";
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  throw new Error(`loadConfig: NODE_ENV must be production, development or test, got "${value}"`);
}

function parseTrustProxy(value: string | undefined): boolean | string {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return value;
}

/** Private webhook destinations: on by default only outside production, and
 *  refused in production (the SSRF guard must not be switchable off there). */
function parseWebhookAllowPrivateHosts(value: string | undefined, nodeEnv: Config["nodeEnv"]): boolean {
  const on = parseBoolEnv(value, nodeEnv !== "production");
  if (on && nodeEnv === "production") {
    throw new Error("loadConfig: WEBHOOK_ALLOW_PRIVATE_HOSTS must not be set when NODE_ENV=production");
  }
  return on;
}

/** The OTP echo-back (devOtpCode in the login response, and the code in the
 *  log) is off unless OTP_DEV_EXPOSE=true is set explicitly, and is refused
 *  in production. It used to default to on whenever NODE_ENV was not
 *  exactly "production", which included the hosted box.
 *
 *  One exception, for the hosted demo: sign-in codes have no delivery
 *  channel yet (no email), so nobody could sign in there. With a second,
 *  separately named switch, OTP_SHOW_IN_PRODUCTION=true (exactly), it is
 *  allowed in production, and the api warns at every boot. While it is on,
 *  the second factor protects nothing: the password alone signs in, so the
 *  demo's passwords must not be public (ops/remote-deploy.sh replaces the
 *  seeded ones). docs/deploy.md. */
function parseOtpDevExpose(
  value: string | undefined,
  nodeEnv: Config["nodeEnv"],
  showInProduction: string | undefined,
): boolean {
  const on = parseBoolEnv(value, false);
  if (on && nodeEnv === "production" && showInProduction !== "true") {
    throw new Error(
      "loadConfig: OTP_DEV_EXPOSE must not be set when NODE_ENV=production (unless OTP_SHOW_IN_PRODUCTION=true: hosted demo only)",
    );
  }
  return on;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected an integer, got "${value}"`);
  }
  return parsed;
}

/** Comma-separated exact origins ("https://dash.example.com"), no paths,
 *  no wildcards: a credentialed CORS response must name one origin. */
function parseOriginList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const origins = value
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o !== "");
  for (const origin of origins) {
    if (origin === "*" || !/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new Error(`loadConfig: CORS_ALLOWED_ORIGINS entry "${origin}" must be an exact origin like https://dash.example.com`);
    }
  }
  return origins;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected a number, got "${value}"`);
  }
  return parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates WEBHOOK_SECRET_ENCRYPTION_KEY decodes to exactly 32 raw bytes,
 *  failing fast at boot (same posture as DATABASE_URL) rather than
 *  accepting a missing/malformed key and only discovering the problem at
 *  first-delivery time. Returns the original base64 string unchanged — the
 *  Config field stays base64-encoded; callers decode to a Buffer at the
 *  point of use. */
function parseWebhookSecretEncryptionKey(value: string | undefined): string {
  if (!value) {
    throw new Error("loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is not set");
  }
  if (!BASE64_RE.test(value)) {
    throw new Error("loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY is not valid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got ${decoded.length}`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("loadConfig: DATABASE_URL environment variable is not set");
  }

  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  const settlementInternalToken = env.SETTLEMENT_INTERNAL_TOKEN ?? "";
  if (nodeEnv === "production" && settlementInternalToken === "") {
    throw new Error("loadConfig: SETTLEMENT_INTERNAL_TOKEN is required when NODE_ENV=production");
  }

  const acquirerCallbackSigningSecret = env.ACQUIRER_CALLBACK_SIGNING_SECRET ?? "";
  if (nodeEnv === "production" && acquirerCallbackSigningSecret === "") {
    throw new Error("loadConfig: ACQUIRER_CALLBACK_SIGNING_SECRET is required when NODE_ENV=production");
  }

  return {
    nodeEnv,
    port: parseIntEnv(env.PORT, 3000),
    databaseUrl,

    // 20, not 5: checkout holds a connection while the acquirer answers
    // (authorize and capture each wait 100-400 ms on the network with their
    // transaction open), so 5 connections capped the whole API at about 10
    // checkouts a second with the CPU mostly idle. Measured on one vCPU,
    // 20 reaches the CPU's limit (~37/s); 40 is no faster.
    // docs/perf/checkout-capacity.md.
    pgPoolMax: parseIntEnv(env.PG_POOL_MAX, 20),
    pgPoolMin: parseIntEnv(env.PG_POOL_MIN, 0),
    pgPoolIdleTimeoutMs: parseIntEnv(env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    pgPoolConnectionTimeoutMs: parseIntEnv(env.PG_POOL_CONNECTION_TIMEOUT_MS, 5_000),

    // Sized from the capacity test on one vCPU: ~30 checkouts/s, so ~32
    // requests in flight keeps an accepted checkout near 1 s.
    overloadMaxInFlight: parseIntEnv(env.OVERLOAD_MAX_IN_FLIGHT, 32),
    // A stall, not ordinary busyness: the in-flight limit does that work.
    overloadMaxEventLoopDelayMs: parseIntEnv(env.OVERLOAD_MAX_EVENT_LOOP_DELAY_MS, 2000),
    overloadMaxPoolWaiting: parseIntEnv(env.OVERLOAD_MAX_POOL_WAITING, 10),

    sessionTtlHours: parseIntEnv(env.SESSION_TTL_HOURS, 12),
    pendingSessionTtlMinutes: parseIntEnv(env.PENDING_SESSION_TTL_MINUTES, 10),
    otpTtlMinutes: parseIntEnv(env.OTP_TTL_MINUTES, 5),
    otpCodeLength: parseIntEnv(env.OTP_CODE_LENGTH, 6),
    otpMaxAttempts: parseIntEnv(env.OTP_MAX_ATTEMPTS, 5),
    otpDevExpose: parseOtpDevExpose(env.OTP_DEV_EXPOSE, nodeEnv, env.OTP_SHOW_IN_PRODUCTION),
    otpDemoDisplay: parseBoolEnv(env.OTP_DEMO_DISPLAY, false),
    otpLogFile: env.OTP_LOG_FILE || undefined,
    loginMaxFailures: parseIntEnv(env.LOGIN_MAX_FAILURES, 10),
    // Off unless set: behind a proxy without TRUST_PROXY every client shares
    // one address, and a per-IP limit would lock everyone out at once.
    loginMaxFailuresPerIp: parseIntEnv(env.LOGIN_MAX_FAILURES_PER_IP, 0),
    loginFailureWindowMinutes: parseIntEnv(env.LOGIN_FAILURE_WINDOW_MINUTES, 15),
    signupMaxPerEmail: parseIntEnv(env.SIGNUP_MAX_PER_EMAIL, 3),
    signupMaxPerIp: parseIntEnv(env.SIGNUP_MAX_PER_IP, 0),
    signupWindowMinutes: parseIntEnv(env.SIGNUP_WINDOW_MINUTES, 60),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),

    argon2MemoryKib: parseIntEnv(env.ARGON2_MEMORY_KIB, 19_456),
    argon2TimeCost: parseIntEnv(env.ARGON2_TIME_COST, 2),
    argon2Parallelism: parseIntEnv(env.ARGON2_PARALLELISM, 1),

    kycUploadDir: env.KYC_UPLOAD_DIR ?? "./data/kyc",
    kycMaxFileSizeBytes: parseIntEnv(env.KYC_MAX_FILE_SIZE_BYTES, 8_388_608),

    acquirerLatencyMinMs: parseIntEnv(env.ACQUIRER_LATENCY_MIN_MS, 100),
    acquirerLatencyMaxMs: parseIntEnv(env.ACQUIRER_LATENCY_MAX_MS, 400),
    acquirerFailureRate: parseFloatEnv(env.ACQUIRER_FAILURE_RATE, 0.02),
    acquirerRngSeed:
      env.ACQUIRER_RNG_SEED !== undefined && env.ACQUIRER_RNG_SEED !== ""
        ? parseIntEnv(env.ACQUIRER_RNG_SEED, 0)
        : null,

    cookieName: env.COOKIE_NAME ?? "fp_sid",
    cookieSecure: parseBoolEnv(env.COOKIE_SECURE, nodeEnv === "production"),
    corsAllowedOrigins: parseOriginList(
      env.CORS_ALLOWED_ORIGINS,
      nodeEnv === "production" ? [] : ["http://localhost:5173", "http://localhost:5174"],
    ),

    adminCookieName: env.ADMIN_COOKIE_NAME ?? "fp_admin_sid",
    adminSessionTtlHours: parseIntEnv(env.ADMIN_SESSION_TTL_HOURS, 8),
    adminPendingSessionTtlMinutes: parseIntEnv(env.ADMIN_PENDING_SESSION_TTL_MINUTES, 10),
    adminOtpTtlMinutes: parseIntEnv(env.ADMIN_OTP_TTL_MINUTES, 5),
    adminOtpCodeLength: parseIntEnv(env.ADMIN_OTP_CODE_LENGTH, 6),
    adminOtpMaxAttempts: parseIntEnv(env.ADMIN_OTP_MAX_ATTEMPTS, 5),

    impersonationCookieName: env.IMPERSONATION_COOKIE_NAME ?? "fp_impersonation",
    impersonationTtlMinutes: parseIntEnv(env.IMPERSONATION_TTL_MINUTES, 15),
    adjustmentImportMaxBytes: parseIntEnv(env.ADJUSTMENT_IMPORT_MAX_BYTES, 10 * 1024 * 1024),
    adjustmentImportMaxRows: parseIntEnv(env.ADJUSTMENT_IMPORT_MAX_ROWS, 20_000),

    settlementInternalUrl: env.SETTLEMENT_INTERNAL_URL ?? "http://settlement:8091",
    settlementInternalToken,
    settlementInternalRequestTimeoutMs: parseIntEnv(env.SETTLEMENT_INTERNAL_REQUEST_TIMEOUT_MS, 30_000),

    checkoutBaseUrl: env.CHECKOUT_BASE_URL ?? "http://localhost:5173",
    paymentLinkReservationTimeoutSeconds: parseIntEnv(env.PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS, 60),

    // No built-in fallback: a key that ships in the repo protects nothing.
    webhookSecretEncryptionKey: parseWebhookSecretEncryptionKey(env.WEBHOOK_SECRET_ENCRYPTION_KEY),
    webhookMaxAttempts: parseIntEnv(env.WEBHOOK_MAX_ATTEMPTS, 8),
    webhookBackoffBaseMs: parseIntEnv(env.WEBHOOK_BACKOFF_BASE_MS, 30_000),
    webhookBackoffCapMs: parseIntEnv(env.WEBHOOK_BACKOFF_CAP_MS, 21_600_000),
    webhookPollIntervalMs: parseIntEnv(env.WEBHOOK_POLL_INTERVAL_MS, 5_000),
    webhookRequestTimeoutMs: parseIntEnv(env.WEBHOOK_REQUEST_TIMEOUT_MS, 10_000),
    webhookAllowPrivateHosts: parseWebhookAllowPrivateHosts(env.WEBHOOK_ALLOW_PRIVATE_HOSTS, nodeEnv),

    acquirerCallbackSigningSecret,
    acquirerCallbackRequireSignature:
      nodeEnv === "production" ? true : parseBoolEnv(env.ACQUIRER_CALLBACK_REQUIRE_SIGNATURE, true),
    acquirerCallbackToleranceSeconds: parseIntEnv(env.ACQUIRER_CALLBACK_SIGNATURE_TOLERANCE_SECONDS, 300),
  };
}
