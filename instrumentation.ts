// Runs once when the server starts, before it handles requests (Next.js instrumentation).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 12.3: fail fast on a missing or malformed environment variable. Next.js would otherwise keep
    // listening and answer every request with a 500, so print the problems and exit.
    const { assertEnv, EnvError } = await import("./lib/env");
    try {
      assertEnv();
    } catch (error) {
      if (!(error instanceof EnvError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
  }
}
