// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const RAY = "8f3c1a2b4d5e6f70-CMB";

function request(path: string, init: { cookie?: string; ray?: string } = {}) {
  const headers = new Headers({ "cf-ray": init.ray ?? RAY });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("OPS-02 proxy", () => {
  it("OPS-02 forwards x-request-id upstream and on the response", () => {
    const response = proxy(request("/products/clay-pot"));
    expect(response.headers.get("x-request-id")).toBe(RAY);
    // NextResponse.next({ request: { headers } }) exposes overridden request headers this way.
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(RAY);
    expect(response.headers.get("location")).toBeNull();
  });

  it("OPS-02 still sends signed-out visitors on protected paths to sign in, with x-request-id", () => {
    for (const path of ["/account", "/account/orders?page=2", "/seller/products", "/admin", "/sell/apply"]) {
      const response = proxy(request(path));
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/signin");
      expect(location.searchParams.get("next")).toBe(path);
      expect(response.headers.get("x-request-id")).toBe(RAY);
    }
  });

  it("OPS-02 lets public paths, /account/wishlist and signed-in visitors through", () => {
    for (const path of ["/", "/accounts-help", "/sell", "/sellers", "/api/catalogue", "/account/wishlist"]) {
      expect(proxy(request(path)).headers.get("location"), path).toBeNull();
    }
    expect(proxy(request("/account", { cookie: "ceyliving_demo_session=user_x" })).headers.get("location")).toBeNull();
  });
});
