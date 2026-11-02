import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { ActionForm } from "./action-form";
import { RegisterForm, SignInForm } from "./auth-forms";

// SEC-A3 / privacy: a form must never fall back to GET before JavaScript loads, or what people typed (passwords,
// phone numbers, bank details) lands in the address bar, the browser history and server logs.

/** The opening <form …> tags in server-rendered HTML, i.e. what the browser has before JavaScript runs. */
const formTags = (html: string) => html.match(/<form\b[^>]*>/g) ?? [];

describe("forms before the page is ready", () => {
  it("ActionForm renders a form that posts to its action, never a bare GET form", () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    const [tag] = formTags(renderToString(<ActionForm action={action} submitLabel="Save" />));
    expect(tag).toMatch(/\saction=/);
    expect(tag).not.toMatch(/method="get"/i);
  });

  it("a form that builds its data in the browser keeps its buttons disabled until the page is ready", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    const form = (
      <ActionForm action={action} submitLabel="Save" needsScript extraButtons={<button type="submit">Draft</button>}>
        <input name="payload" defaultValue="{}" />
      </ActionForm>
    );
    const html = renderToString(form);
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toContain("Loading…");

    render(form); // in the browser, after React has taken over
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Draft" })).toBeEnabled();
  });

  it("once ready, ActionForm sends through its action with the pressed button, and keeps what was typed on errors", async () => {
    const action = vi.fn(async (_: ActionState, data: FormData): Promise<ActionResult> => ({
      ok: false,
      message: `Fix the name (${String(data.get("intent"))})`,
      fieldErrors: { name: "Too short" },
    }));
    render(
      <ActionForm action={action} submitLabel="Save" submitName="intent" submitValue="submit">
        <input name="name" aria-label="Name" />
      </ActionForm>,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Al");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fix the name (submit)");
    expect(screen.getByLabelText("Name")).toHaveValue("Al");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("sign-in and register post to their server actions, never GET, so a password can't reach a URL", () => {
    for (const html of [
      renderToString(<SignInForm next="/" />),
      renderToString(<RegisterForm seller={false} next="/" turnstileSiteKey="1x00000000000000000000AA" />),
    ]) {
      const [tag] = formTags(html);
      expect(tag).toMatch(/\saction=/);
      expect(tag).not.toMatch(/method="get"/i);
    }
  });
});
