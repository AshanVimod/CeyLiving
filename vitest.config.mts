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
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    // One PostgreSQL container for the whole run (Docker required); each test file copies the migrated database.
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Better Auth sets the session cookie through next/headers; processing it here lets the tests' mock of
    // next/headers (test/auth.ts) catch that cookie, as a browser would.
    server: { deps: { inline: ["better-auth"] } },
  },
});
