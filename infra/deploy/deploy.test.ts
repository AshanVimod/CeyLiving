import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// B14 (17.3): infra/deploy/deploy.sh, the script the deploy workflow runs on the VPS, driven against a fake `docker`
// that records every call. Bash is needed: CI's Linux has it; on Windows, Git for Windows' bash.

const BASH =
  process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync)
    : "bash";
const SCRIPT = path.join(process.cwd(), "infra", "deploy", "deploy.sh").replace(/\\/g, "/");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OLD = "fedcba9876543210fedcba9876543210fedcba98";
const REGISTRY = "ghcr.io/example";

/** A `docker` that logs each call (with the image compose would run) and fails where FAKE_FAIL says. */
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $* | image=\${CEYLIVING_IMAGE:-}" >> "$FAKE_LOG"
case " $* " in
  *" pull "*) [[ "$FAKE_FAIL" == pull ]] && exit 1; exit 0 ;;
  *" --entrypoint cat "*) cat "$FAKE_SHIPPED_COMPOSE"; exit 0 ;;
  *" run --rm --no-deps migrate "*) [[ "$FAKE_FAIL" == migrate ]] && exit 1; exit 0 ;;
  *" up "*) [[ "$FAKE_FAIL" == up && "$CEYLIVING_IMAGE" == *"$FAKE_NEW"* ]] && exit 1; exit 0 ;;
  *" exec "*) exit 0 ;;
  *" ps -q worker "*) echo "worker-of-\${CEYLIVING_IMAGE##*:}"; exit 0 ;;
  *" inspect "*) [[ "$FAKE_FAIL" == worker && "$*" == *"$FAKE_NEW"* ]] && echo "3 true" || echo "0 true"; exit 0 ;;
esac
exit 0
`;

let dir: string;
const posix = (p: string) => p.replace(/\\/g, "/");

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(BASH!, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`,
      CEYLIVING_ROOT: posix(path.join(dir, "srv")),
      FAKE_LOG: posix(path.join(dir, "docker.log")),
      FAKE_SHIPPED_COMPOSE: posix(path.join(dir, "shipped.yml")),
      FAKE_NEW: COMMIT,
      FAKE_FAIL: "",
      WORKER_SETTLE_SECONDS: "0",
      ...env,
    },
  });
  const log = existsSync(path.join(dir, "docker.log")) ? readFileSync(path.join(dir, "docker.log"), "utf8") : "";
  return { status: result.status, out: result.stdout + result.stderr, calls: log.trim().split("\n").filter(Boolean) };
}

const state = (name: string) => {
  const file = path.join(dir, "srv", "staging", ".deploy", name);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};

describe.skipIf(!BASH)("deploy.sh", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ceyliving-deploy-"));
    mkdirSync(path.join(dir, "bin"));
    writeFileSync(path.join(dir, "bin", "docker"), FAKE_DOCKER, { mode: 0o755 });
    const root = path.join(dir, "srv", "staging");
    mkdirSync(path.join(root, ".deploy"), { recursive: true });
    writeFileSync(path.join(root, "docker-compose.yml"), "services: {}\n");
    writeFileSync(path.join(dir, "shipped.yml"), "services: {}\n");
    writeFileSync(path.join(root, "deploy.conf"), `CEYLIVING_REGISTRY=${REGISTRY}\n`);
    writeFileSync(
      path.join(root, ".deploy", "current.env"),
      `CEYLIVING_IMAGE=${REGISTRY}/ceyliving:${OLD}-staging\nCEYLIVING_BACKUP_IMAGE=${REGISTRY}/ceyliving-backup:${OLD}\n`,
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("17.3 DB-11 runs the new image's migrations before switching web and worker to it", () => {
    const { status, calls, out } = run(["staging", "deploy", `${COMMIT}-staging`]);
    expect(status, out).toBe(0);
    const migrate = calls.findIndex((c) => c.includes("run --rm --no-deps migrate"));
    const up = calls.findIndex((c) => c.includes(" up -d --no-deps --wait"));
    expect(migrate).toBeGreaterThan(-1);
    expect(up).toBeGreaterThan(migrate);
    expect(calls[migrate]).toContain(`image=${REGISTRY}/ceyliving:${COMMIT}-staging`);
    expect(calls[up]).toContain(`image=${REGISTRY}/ceyliving:${COMMIT}-staging`);
    expect(calls[up]).toContain("web worker cloudflared");
    expect(calls.at(-1)).toContain("exec -T web node /app/ops/warm.mjs");
    expect(state("current.env")).toContain(`${COMMIT}-staging`);
    expect(state("previous.env")).toContain(`${OLD}-staging`);
  });

  it("17.3 DB-11 switches nothing when the migrations fail", () => {
    const { status, calls, out } = run(["staging", "deploy", `${COMMIT}-staging`], { FAKE_FAIL: "migrate" });
    expect(status).toBe(1);
    expect(out).toContain('"step":"migrate"');
    expect(calls.some((c) => c.includes(" up "))).toBe(false);
    expect(state("current.env")).toContain(`${OLD}-staging`);
  });

  it("17.3 DB-11 starts the previous version again when the new one isn't ready", () => {
    const { status, calls, out } = run(["staging", "deploy", `${COMMIT}-staging`], { FAKE_FAIL: "up" });
    expect(status).toBe(1);
    expect(out).toContain('"step":"not_ready"');
    const ups = calls.filter((c) => c.includes(" up "));
    expect(ups).toHaveLength(2);
    expect(ups[1]).toContain(`image=${REGISTRY}/ceyliving:${OLD}-staging`);
    expect(state("current.env")).toContain(`${OLD}-staging`);
  });

  it("17.3 counts a worker that keeps restarting as not ready, and starts the previous version again", () => {
    const { status, calls, out } = run(["staging", "deploy", `${COMMIT}-staging`], { FAKE_FAIL: "worker" });
    expect(status).toBe(1);
    expect(out).toContain("deploy.worker_not_stable");
    const ups = calls.filter((c) => c.includes(" up "));
    expect(ups.at(-1)).toContain(`image=${REGISTRY}/ceyliving:${OLD}-staging`);
    expect(state("current.env")).toContain(`${OLD}-staging`);
  });

  it("17.3 rollback switches to the previous tag without migrating", () => {
    expect(run(["staging", "deploy", `${COMMIT}-staging`]).status).toBe(0);
    rmSync(path.join(dir, "docker.log"));
    const { status, calls, out } = run(["staging", "rollback"]);
    expect(status, out).toBe(0);
    expect(calls.some((c) => c.includes("migrate"))).toBe(false);
    expect(calls.find((c) => c.includes(" up "))).toContain(`image=${REGISTRY}/ceyliving:${OLD}-staging`);
    expect(state("current.env")).toContain(`${OLD}-staging`);
  });

  it("17.3 the deploy key's command is read as words, and a bad tag, environment or compose file stops it", () => {
    const viaSsh = run(["staging"], { SSH_ORIGINAL_COMMAND: `deploy ${COMMIT}-staging` });
    expect(viaSsh.status, viaSsh.out).toBe(0);

    for (const tag of ["latest", `${COMMIT}-production`, `${COMMIT}-staging;reboot`, `$(id)-staging`]) {
      rmSync(path.join(dir, "docker.log"), { force: true });
      const bad = run(["staging"], { SSH_ORIGINAL_COMMAND: `deploy ${tag}` });
      expect(bad.status, tag).toBe(2);
      expect(bad.calls).toEqual([]);
    }
    expect(run(["qa", "deploy", `${COMMIT}-staging`]).status).toBe(2);

    writeFileSync(path.join(dir, "shipped.yml"), "services: { extra: {} }\n");
    const differs = run(["staging", "deploy", `${COMMIT}-staging`]);
    expect(differs.status).toBe(1);
    expect(differs.out).toContain("compose_file_differs");
    expect(differs.calls.some((c) => c.includes("migrate"))).toBe(false);
  });
});
