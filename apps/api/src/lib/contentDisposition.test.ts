/** Content-Disposition with hostile or non-ASCII filenames. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { contentDisposition } from "./contentDisposition.js";

test("quotes, CR/LF and semicolons can't break out of the header value", () => {
  const h = contentDisposition("inline", 'a".pdf\r\nSet-Cookie: x=1; b');
  assert.equal(/[\r\n]/.test(h), false);
  assert.equal(h.split('"').length, 3, "exactly one quoted fallback");
});

test("non-Latin-1 names are encoded, not passed raw", () => {
  const h = contentDisposition("inline", "سجل تجاري.pdf");
  assert.match(h, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''[%A-Za-z0-9._~-]+$/);
  assert.ok(h.includes("%D8%B3"), "UTF-8 percent-encoding");
});

test("plain names are unchanged in the fallback", () => {
  assert.equal(contentDisposition("inline", "CR-2026.pdf"), `inline; filename="CR-2026.pdf"; filename*=UTF-8''CR-2026.pdf`);
});
