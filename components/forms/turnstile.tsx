"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useActionResult, useFieldError } from "./action-form";

// AU-06: Cloudflare Turnstile inside an ActionForm. The widget puts its token in a hidden "cf-turnstile-response"
// field of the form; the server action checks that token with Cloudflare (lib/server/turnstile.ts). This component
// only shows the check; it decides nothing.

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Shown from the start when `always` (sign-up, password reset), otherwise from the moment the server asks for it
 * (sign-in after 3 failed attempts), and then kept. After every answer from the server it resets, because each
 * token works once.
 */
export function TurnstileField({ siteKey, always = false }: { siteKey: string; always?: boolean }) {
  const error = useFieldError("turnstile");
  const result = useActionResult();
  const [asked, setAsked] = useState(false);
  if (error && !asked) setAsked(true);
  const shown = always || asked;

  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Runs again once the script is ready (`ready`); on a later visit the script is already there.
    const api = window.turnstile;
    if (!shown || !api || !box.current) return;
    widget.current = api.render(box.current, { sitekey: siteKey, theme: "light", size: "flexible" });
    return () => {
      if (widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [shown, ready, siteKey]);

  useEffect(() => {
    if (result && widget.current) window.turnstile?.reset(widget.current);
  }, [result]);

  if (!shown) return null;
  return (
    <div>
      <Script src={SCRIPT} strategy="afterInteractive" onReady={() => setReady(true)} />
      <p className="mb-1.5 text-[0.95rem] font-medium">Security check</p>
      <div ref={box} className="min-h-[65px]" />
      {error ? <p className="mt-1.5 text-sm text-lacquer">{error}</p> : null}
    </div>
  );
}
