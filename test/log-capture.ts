import { createLogger } from "@/lib/server/observability/logger";

/** A real logger (redaction and serializers included) whose JSON lines are parsed into `lines`. */
export function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: {
      write(line: string) {
        raw.push(line);
        lines.push(JSON.parse(line));
      },
    },
  });
  return { logger, lines, raw };
}
