# 12: KYC uploads trusted filenames and decoded images without limits

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Fixed (5 commits, not pushed) |
| **Component** | `apps/api/src/onboarding/kyc.ts`, `onboarding/kycThumbnail.ts`, `plugins/multipart.ts`, `routes/kyc.ts` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

1. **"PDF only" was checked on the filename.** Commercial registrations and
   bank letters must be PDFs. The check was `fileName.endsWith(".pdf")`, even
   though the detected type from the file's bytes was already known. A comment
   said this was "fixed in FP-231". A JPEG or PNG named `CR-2026.pdf` was
   accepted.
2. **Images were decoded without a sensible pixel limit.** The 8 MiB cap
   limits bytes, not pixels. sharp's default limit is about 268 megapixels, so
   a PNG of a few KB declaring a huge canvas took up to a gigabyte to
   thumbnail. A few in parallel could crash the API.
3. **A decode error was a 500 that left a file behind.** The original was
   written to disk before the thumbnail was made, and nothing cleaned up when
   the thumbnail or the database insert failed.
4. **Any number of files per request.** The parser had only a size limit, and
   the route read every file part into memory and kept the last. A comment
   claimed one file was enforced.
5. **Unsafe download filename.** The merchant-supplied name went raw into
   `Content-Disposition: inline; filename="..."`. A quote broke the header, and
   a non-Latin-1 name such as an Arabic filename made Node throw (500).

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: KYC uploads check bytes not names, bound image decoding, take one file` | 3 of 4 cases fail before the fix. |
| 2 | `kyc: enforce PDF-only document types on the file's bytes` | `detected === "pdf"` is required; the filename check stays as well. |
| 3 | `kyc: bound image decoding and leave no files behind on failure` | Header read first; over 25 MP is `422 image_too_large`. Decode uses `limitInputPixels` and `failOn`; unreadable images are `422 invalid_image`. Files are written only after the checks. (Removing them after a failed insert was dropped in [18](18-review-follow-ups.md): it could delete a file a concurrent upload of the same content still needs.) |
| 4 | `kyc: one file per upload, bounded form parts, safe download filenames` | Second file is `400 one_file_only`; parser limits files, fields and parts. `contentDisposition()` sends an ASCII fallback plus RFC 5987 `filename*`. |
| 5 | `docs: cyper 12, KYC uploads` | This file. |

## Verified

`kycUploadSafety.test.ts` (4), `contentDisposition.test.ts` (3), `app.test.ts`
(its KYC cases included), `admin.test.ts` and `onboarding/*.test.ts` pass.

## Not changed

- **PDF/image polyglots** (a file that is a valid PDF and a valid JPEG at once)
  still pass, as before. A note in the code parks this. Reviewers open the file
  as a PDF.
- **PDFs aren't scanned** for active content. They are served `inline` with
  their detected type to admin reviewers. Consider `attachment` for PDFs, or
  serving them from a separate origin.
