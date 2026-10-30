import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";

export interface MultipartPluginOptions {
  config: Pick<Config, "kycMaxFileSizeBytes">;
}

/** Registers @fastify/multipart size-limited to `config.kycMaxFileSizeBytes`
 *  — oversized uploads are rejected by the plugin before any handler runs,
 *  never buffered in full. */
// At most two file parts reach a handler (so routes/kyc.ts can see and refuse
// a second one with a clear 400 instead of the parser tearing the stream down
// mid-read), and a handful of small fields. The old note said one file per
// request was enforced in routes/kyc.ts; it wasn't, the route read every
// file into memory and kept the last.
export const multipartPlugin = fp<MultipartPluginOptions>(async (app: FastifyInstance, opts): Promise<void> => {
  await app.register(multipart, {
    limits: { fileSize: opts.config.kycMaxFileSizeBytes, files: 2, fields: 5, parts: 7, fieldSize: 1_024 },
  });
});
