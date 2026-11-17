// B14 (17.2): bundles the worker and the operations commands for the Docker image, which has no tsx or TypeScript.
// Only this repository's code is bundled (path aliases resolved); every npm package stays an import, loaded from the
// image's production node_modules. Run them with `node --conditions=react-server dist/<name>.mjs`, like `npm run worker`.
import { build } from "esbuild";

/**
 * `server-only` is a dev dependency that is empty under the react-server condition; inline it as empty so the image's
 * production node_modules doesn't need it.
 */
const serverOnly = {
  name: "server-only",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
  },
};

const entryPoints = {
  worker: "worker/index.ts",
  "jobs-migrate": "worker/migrate-cli.ts",
  "ops-checkpoint": "scripts/ops-checkpoint.ts",
  "payouts-reencrypt": "scripts/payouts-reencrypt.ts",
};

await build({
  entryPoints,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  sourcemap: true,
  plugins: [serverOnly],
  logLevel: "info",
});
