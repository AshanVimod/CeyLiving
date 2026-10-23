import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./demo-banner";

afterEach(() => vi.unstubAllEnvs());

describe("DemoBanner", () => {
  it("SEC-A8 renders nothing without DEMO_MODE", () => {
    const { container } = render(<DemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns testers and links to the feedback form when DEMO_MODE=true", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("FEEDBACK_URL", "https://forms.gle/example");
    render(<DemoBanner />);
    expect(screen.getByRole("complementary", { name: "Demo version" })).toHaveTextContent(
      "Demo version — data resets regularly, no real payments. Don’t enter real personal details.",
    );
    const link = screen.getByRole("link", { name: /Give feedback/ });
    expect(link).toHaveAttribute("href", "https://forms.gle/example");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides the feedback button when FEEDBACK_URL is not set", () => {
    vi.stubEnv("DEMO_MODE", "true");
    render(<DemoBanner />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
