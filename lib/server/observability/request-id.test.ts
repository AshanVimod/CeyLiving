// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("OPS-02 request ID", () => {
  it("OPS-02 reuses a well-formed cf-ray", () => {
    expect(resolveRequestId(new Headers({ "cf-ray": "8f3c1a2b4d5e6f70-CMB" }))).toBe("8f3c1a2b4d5e6f70-CMB");
  });

  it("OPS-02 ignores a malformed cf-ray and generates a UUID", () => {
    expect(resolveRequestId(new Headers({ "cf-ray": 'x" level=info msg=forged' }))).toMatch(UUID);
  });

  it("OPS-02 never trusts a client-sent x-request-id", () => {
    expect(resolveRequestId(new Headers({ "x-request-id": "chosen-by-client" }))).toMatch(UUID);
  });
});
