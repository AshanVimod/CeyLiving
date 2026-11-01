import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["**/*.test.{ts,tsx}"],
          exclude: ["node_modules", ".next", ".data", "test/contract/**"],
        },
      },
      // Repository contract tests (backend plan 6.2): one PostgreSQL container for the whole run, started by the
      // global setup only when a contract test is selected. Each test file gets its own copy of the database.
      {
        extends: true,
        test: {
          name: "contract",
          environment: "node",
          include: ["test/contract/**/*.test.ts"],
          globalSetup: ["./test/contract/global-setup.ts"],
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
