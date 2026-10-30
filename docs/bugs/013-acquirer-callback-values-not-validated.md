# 013: The acquirer callback stores any outcome and retries errors that can never succeed

**Severity:** Low. Wrong data could be saved on a transaction's timeline,
and some bad callbacks got a 500 after a pointless wait.

## Where

- `apps/api/src/routes/acquirerCallbacks.ts`: `POST /v1/acquirer/callbacks`.
- `apps/api/src/acquirer/callbacks.ts`: `withCallbackRetry`.

## Why it was wrong

The route's comment said `outcome` "is validated ... ('approved' |
'rejected'); any other value is a 400". In fact:

- The values are really `cleared` and `confirmed_fraud`.
- The handler only checked that the field was present, then cast it:
  `outcome: body.outcome as AcquirerCallbackInput["outcome"]`.
- `acquirer_callback_notes.outcome` has no CHECK, so any string was saved
  and shown to support on the timeline.
- A `transactionId` that is not a UUID, or an `occurredAt` that is not a
  date, reached SQL and failed there.

`withCallbackRetry` retried every error three times, including
`NotFoundError` for an unknown transaction, which cannot change between
attempts.

## How to reproduce

Send a correctly signed callback with `outcome: "definitely_fine"`. Before
the fix: 200, and the note is saved. With `transactionId: "not-a-uuid"`:
three attempts, then 500.

## Fix

After the signature check, the handler checks the values:

- `outcome` must be `cleared` or `confirmed_fraud` (`400 invalid_outcome`).
- `transactionId` must be a UUID.
- `occurredAt` must be a real date-time; the check refuses `2026-02-30`.
- `callbackId` and `note` must be strings.

`withCallbackRetry` stops at an `AppError` (a definite answer) and only
retries unexpected errors such as a dropped connection.

## Test

- `apps/api/src/routes/acquirerCallbacks.test.ts`: "refuses an unknown
  outcome, a bad transaction id or date with a 400". Got 200 before the fix.
- `apps/api/src/acquirer/callbacks.test.ts`: "withCallbackRetry does not
  retry an AppError such as 404". Made 3 attempts before the fix.
