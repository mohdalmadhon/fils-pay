#!/usr/bin/env node
/** Compile the existing Node services; dependencies stay external and money
 * source is read unchanged. Migrations/seed keep their existing tsx commands.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspaces = new Map([
  ["@filspay/money", resolve(root, "packages/money/src/index.ts")],
  ["@filspay/events", resolve(root, "packages/events/src/index.ts")],
]);

await build({
  absWorkingDir: root,
  entryPoints: { api: "apps/api/src/index.ts", reporting: "apps/reporting/src/index.ts" },
  outdir: "build/node",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  plugins: [{
    name: "local-workspaces",
    setup(bundler) {
      bundler.onResolve({ filter: /^@filspay\/(money|events)$/ }, (args) => ({
        path: workspaces.get(args.path), external: false,
      }));
    },
  }],
});
