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
