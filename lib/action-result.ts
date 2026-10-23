/** What every server action returns to its form. Safe to import from client components. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export type ActionState = ActionResult | null;
