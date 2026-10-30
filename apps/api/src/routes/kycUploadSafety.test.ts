/**
 * KYC upload safety.
 *
 * Before the fix:
 *  - "PDF only" documents were checked against the filename, so a JPEG or PNG
 *    named cr.pdf was accepted as a commercial registration;
 *  - thumbnails were decoded with sharp's default ~268-megapixel limit, so a
 *    small PNG declaring a huge canvas could take a gigabyte to decode, and a
 *    decode failure was a 500 that left the original file on disk;
 *  - the multipart parser accepted any number of files (the last one won).
 *
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { parseCookie } from "../testing/adminFixtures.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("kycUploadSafety.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const uploadDir = await mkdtemp(join(tmpdir(), "kyc-safety-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  KYC_UPLOAD_DIR: uploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function owner() {
  const email = `kyc-${randomUUID()}@example.test`;
  const password = "kyc safety password 1!";
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `KYC Co ${randomUUID().slice(0, 6)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `c-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const { merchantId } = signup.json() as { merchantId: string };
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  const cookie = parseCookie(login.headers["set-cookie"], config.cookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return { merchantId, cookie };
}

interface FilePart {
  filename: string;
  data: Buffer;
}

function multipart(documentType: string, files: FilePart[]) {
  const boundary = `----kyc${randomUUID().replace(/-/g, "")}`;
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\n${documentType}\r\n`),
  ];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      f.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(who: { merchantId: string; cookie: string }, documentType: string, files: FilePart[]) {
  const { body, contentType } = multipart(documentType, files);
  return app.inject({
    method: "POST",
    url: `/v1/merchants/${who.merchantId}/kyc/documents`,
    headers: { cookie: who.cookie, "content-type": contentType },
    payload: body,
  });
}

const smallPng = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();

test("a PNG named .pdf is refused for a PDF-only document type", async () => {
  const who = await owner();
  const res = await upload(who, "commercial_registration", [{ filename: "CR-2026.pdf", data: await smallPng() }]);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal((res.json() as { error: string }).error, "document_must_be_pdf");
});

test("an image with a huge pixel count is refused cleanly, and nothing is left on disk", async () => {
  const who = await owner();
  // 6000 x 6000 = 36 MP: a few KB compressed, ~100 MB decoded.
  const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "#000" } }).png().toBuffer();
  assert.ok(bomb.length < config.kycMaxFileSizeBytes, "fits under the upload size cap");
  const res = await upload(who, "owner_id", [{ filename: "id.png", data: bomb }]);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal((res.json() as { error: string }).error, "image_too_large");
  const leftovers = await readdir(join(uploadDir, who.merchantId)).catch(() => [] as string[]);
  assert.deepEqual(leftovers, [], "no orphaned file");
});

test("a request with more than one file is refused", async () => {
  const who = await owner();
  const png = await smallPng();
  const res = await upload(who, "owner_id", [
    { filename: "a.png", data: png },
    { filename: "b.png", data: png },
  ]);
  assert.ok(res.statusCode === 413 || res.statusCode === 400, `${res.statusCode} ${res.body}`);
});

test("a normal image upload still works", async () => {
  const who = await owner();
  const res = await upload(who, "owner_id", [{ filename: "id.png", data: await smallPng() }]);
  assert.equal(res.statusCode, 201, res.body);
});
