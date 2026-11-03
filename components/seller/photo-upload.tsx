"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { UPLOAD_LIMITS } from "@/lib/config";
import { applicationPhotoUrl, photoUrl } from "@/lib/photos";
import { confirmUploadAction, requestUploadAction, uploadStatusAction } from "@/lib/server/actions/uploads";
import type { UploadPurpose } from "@/lib/types";
import { smallButton } from "./product-form-fields";

// B09 (backend plan 11.1): one photo slot. The file goes straight from the browser to storage; the app only hands
// out the address, hears that the file arrived, and waits for image.process to check and resize it. The slot's
// value is the photo id the form sends (empty until a photo is ready). The checks here only save a wasted upload;
// the server checks everything again (SEC-07).

type Phase = "idle" | "uploading" | "processing" | "error";

const POLL_MS = 1000;
const POLL_TRIES = 60;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PhotoUploadProps {
  purpose: UploadPurpose;
  /** The photo id, or "" for an empty slot. */
  value: string;
  onChange: (id: string) => void;
  /** Names the slot for screen readers, e.g. "Photo 2" or "Logo". */
  label: string;
  /** When set, a hidden input carries the id in plain form posts. */
  name?: string;
  invalid?: boolean;
  /** Wide slots (a shop banner) show a wider preview. */
  wide?: boolean;
}

export function PhotoUpload({ purpose, value, onChange, label, name, invalid, wide }: PhotoUploadProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const fail = (text: string) => {
    if (!live.current) return;
    setPhase("error");
    setMessage(text);
  };

  async function upload(file: File) {
    if (!(UPLOAD_LIMITS.types as readonly string[]).includes(file.type))
      return fail("Choose a JPEG, PNG or WebP photo.");
    if (file.size > UPLOAD_LIMITS.maxBytes) return fail("Choose a photo under 8 MB.");
    setPreview(URL.createObjectURL(file));
    setPhase("uploading");
    setMessage("Uploading…");

    const ticket = await requestUploadAction({ purpose, contentType: file.type, sizeBytes: file.size });
    if (!ticket.ok || !ticket.url || !ticket.uploadId) return fail(ticket.message ?? "The photo couldn’t be uploaded.");
    const sent = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: file }).catch(() => null);
    if (!sent?.ok) return fail("The photo couldn’t be uploaded. Check your connection and try again.");

    if (!live.current) return;
    setPhase("processing");
    setMessage("Checking and resizing the photo…");
    let state = await confirmUploadAction({ uploadId: ticket.uploadId });
    for (let i = 0; state.ok && state.status === "PENDING" && i < POLL_TRIES && live.current; i++) {
      await sleep(POLL_MS);
      state = await uploadStatusAction({ uploadId: ticket.uploadId });
    }
    if (!live.current) return;
    if (!state.ok) return fail(state.message);
    if (state.status === "REJECTED") return fail(state.reason ?? "That photo can’t be used. Try another one.");
    if (state.status !== "READY") return fail("This is taking longer than usual. Try again in a minute.");
    onChange(ticket.uploadId);
    setPhase("idle");
    setMessage("Photo ready.");
  }

  const busy = phase === "uploading" || phase === "processing";
  const shown = busy || phase === "error" ? preview : undefined;
  const src = value ? (purpose === "APPLICATION_PHOTO" ? applicationPhotoUrl(value) : photoUrl(value)) : undefined;

  return (
    <div className="flex items-center gap-3">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div
        className={`relative shrink-0 overflow-hidden rounded-md border bg-sage ${wide ? "h-16 w-32" : "size-16"} ${
          invalid || phase === "error" ? "border-lacquer" : "border-line"
        }`}
      >
        {shown ? (
          <Image src={shown} alt="" fill unoptimized className={`object-cover ${busy ? "opacity-60" : ""}`} />
        ) : src ? (
          <Image src={src} alt="" fill sizes={wide ? "128px" : "64px"} className="object-cover" />
        ) : null}
      </div>
      <div className="min-w-0">
        <input
          ref={input}
          type="file"
          accept={UPLOAD_LIMITS.types.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file).catch(() => fail("The photo couldn’t be uploaded. Try again."));
          }}
        />
        <button
          type="button"
          className={smallButton}
          disabled={busy}
          aria-describedby={statusId}
          onClick={() => input.current?.click()}
        >
          {value ? `Replace ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
        </button>
        <p
          id={statusId}
          aria-live="polite"
          className={`mt-1 text-sm ${phase === "error" ? "text-lacquer" : "text-ink-soft"}`}
        >
          {message || "JPEG, PNG or WebP, up to 8 MB."}
        </p>
      </div>
    </div>
  );
}
