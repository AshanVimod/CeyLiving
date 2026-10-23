// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSeed } from "./seed";
import { migrate, STORE_VERSION, type StoreData } from "./dev-store";

describe("dev store upgrades", () => {
  it("FR-2a a version-2 store keeps its applications, now with categories, an address and the applicant's name", () => {
    const seed = buildSeed(new Date("2026-10-22T06:00:00.000Z"));
    const [app] = seed.applications;
    const { categorySlugs, address, applicantName, businessType, ...rest } = app!;
    void [address, applicantName, businessType];
    const v2 = {
      ...seed,
      version: 2,
      applications: [{ ...rest, categorySlug: categorySlugs[0], district: "Matale" }],
    } as unknown as StoreData;

    const upgraded = migrate(v2);
    expect(upgraded.version).toBe(STORE_VERSION);
    expect(upgraded.applications[0]).toMatchObject({
      id: app!.id,
      shopName: app!.shopName,
      categorySlugs: [categorySlugs[0]],
      address: { line1: "", city: "", district: "Matale" },
      applicantName: seed.users.find((u) => u.id === app!.userId)!.name,
      businessType: "INDIVIDUAL",
    });
    expect(upgraded.applications[0]).not.toHaveProperty("categorySlug");
    expect(upgraded.applications[0]).not.toHaveProperty("district");
  });
});
