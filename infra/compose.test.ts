import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// B14 (17.2): docker-compose.yml as Docker Compose resolves it (`docker compose config`), with empty env files.
// Docker is already required by the test set-up (Testcontainers).

type Service = {
  ports?: unknown[];
  user?: string;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: { test: string[] };
  deploy?: { resources?: { limits?: { memory?: unknown } } };
  profiles?: string[];
  scale?: number;
  command?: string[];
};

let dir: string;
let services: Record<string, Service>;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ceyliving-compose-"));
  copyFileSync("docker-compose.yml", path.join(dir, "docker-compose.yml"));
  mkdirSync(path.join(dir, "env"));
  for (const name of ["common", "web", "worker", "migrate", "tunnel", "backup"]) {
    writeFileSync(path.join(dir, "env", `${name}.env`), "");
  }
  const json = execFileSync(
    "docker",
    ["compose", "-f", path.join(dir, "docker-compose.yml"), "--profile", "ops", "config", "--format", "json"],
    {
      encoding: "utf8",
      env: { ...process.env, CEYLIVING_IMAGE: "ceyliving:test", COMPOSE_PROJECT_NAME: "ceyliving-test" },
    },
  );
  services = JSON.parse(json).services;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("docker-compose.yml", () => {
  it("17.2 has the web, worker, tunnel, migrate and backup services", () => {
    expect(Object.keys(services).sort()).toEqual(["backup", "cloudflared", "migrate", "web", "worker"]);
    expect(services.backup!.profiles).toEqual(["ops"]); // never started by `docker compose up`
  });

  it("17.2 publishes no port on the host: the tunnel is the only way in", () => {
    for (const [name, service] of Object.entries(services)) expect(service.ports ?? [], name).toEqual([]);
  });

  it("17.2 every service runs unprivileged: no root, no capabilities, no new privileges, memory limit", () => {
    for (const [name, service] of Object.entries(services)) {
      expect(service.cap_drop, name).toEqual(["ALL"]);
      expect(service.security_opt, name).toContain("no-new-privileges:true");
      expect(service.deploy?.resources?.limits?.memory, name).toBeTruthy();
    }
    for (const name of ["web", "worker", "migrate"]) expect(services[name]!.user, name).toBe("node");
    // cloudflared and backup run as their images' own non-root users (nonroot, postgres).
    expect(services.cloudflared!.user).toBeUndefined();
  });

  it("17.2 only the web app can write to its file system (Next's page cache, decision D-d)", () => {
    for (const name of ["worker", "migrate", "cloudflared", "backup"])
      expect(services[name]!.read_only, name).toBe(true);
    expect(services.web!.read_only).toBeFalsy();
  });

  it("17.2 DB-11 web and worker start only after the migrate step succeeded", () => {
    for (const name of ["web", "worker"]) {
      expect(services[name]!.depends_on?.migrate?.condition, name).toBe("service_completed_successfully");
    }
    expect(services.migrate!.command).toEqual(["sh", "/app/ops/migrate.sh"]);
  });

  it("17.2 OPS-05 the web health check is /api/ready, and there is one web process (decision D-a)", () => {
    expect(services.web!.healthcheck?.test.join(" ")).toContain("/api/ready");
    expect(services.web!.scale).toBe(1);
  });
});
