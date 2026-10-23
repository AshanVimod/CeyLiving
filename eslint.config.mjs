import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // OPS-01: application code logs through lib/server/observability/logger.ts, never console.
  // instrumentation.ts (runs before the environment is valid) and scripts/ are exempt.
  {
    files: ["app/**", "lib/**", "components/**", "proxy.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
  // BE-01: only repositories (and the transaction handle) touch stored rows; everything else goes through them.
  {
    files: ["app/**", "lib/**", "components/**", "proxy.ts"],
    ignores: ["lib/server/db/**", "lib/server/repositories/**", "lib/server/store/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/store/dev-store"],
              message: "Read and write data through lib/server/repositories with a db or withTx handle (BE-01).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
