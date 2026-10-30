# 08: Card numbers and references accepted any text, including NUL bytes and objects

**Severity:** Low. No data leaked, but unchecked input reached the acquirer
and the database, and could crash a request.

**Area:** card payments (`POST /v1/transactions`) and payment links (create;
the text is shown to buyers at checkout).

## How it was tested

While checking where card data goes, the leak test found that:

- `POST /v1/transactions` accepted a card number with a NUL byte or letters
  in it, and passed it to the acquirer as it was;
- the same route accepted `reference: {"note":"x"}`, a number or a boolean,
  and stored it as text (`{"note":"x"}`);
- a reference containing a NUL byte reached Postgres, which rejects it, and
  came back as a 500.

Payment-link `reference` and `description` had the same gaps, and those two
fields appear on the public checkout page.

## Why it happened

Bug 008 added shape checks (`apps/api/src/lib/paymentInput.ts`): the card
number and CVV had to be strings, and the month a real month. They did not
check what the strings contained, and the text fields were not checked at
all.

## Fix

- **Card number:** spaces and dashes, as people type them, are dropped; what
  is left must be 12 to 19 digits.
- **CVV:** 3 or 4 digits.
- **References and descriptions:** the new `parseReference` accepts text of
  at most 255 characters with no control characters. It is used for the
  transaction `reference` and the payment link's `reference` and
  `description`.

Anything else gets a 400 before it reaches the acquirer or the database. The
checkout page already sends digits; spaced numbers still work.

## Test

- `apps/api/src/routes/transactions.test.ts`: "card number, CVV and
  reference are checked: digits only, no control characters". A NUL or
  letters in the number, letters in the CVV, an object reference, a NUL in
  the reference and a 300-character reference all get 400; a spaced number
  still works.
- `apps/api/src/routes/paymentLinks.test.ts`: "a payment link's reference
  and description must be plain text".

Before the fix the first case answered 201.
