"use client";

import { useState, useTransition } from "react";
import { toggleHelpfulAction } from "@/lib/server/actions/extras";

interface HelpfulButtonProps {
  targetType: "REVIEW" | "QUESTION";
  targetId: string;
  count: number;
  voted: boolean;
  /** Own posts can't be voted on (FR-19); the count is still shown. */
  disabled?: boolean;
}

/** FR-19: "Helpful" with a count. Updates straight away; the server decides and corrects if needed. */
export function HelpfulButton({ targetType, targetId, count, voted, disabled }: HelpfulButtonProps) {
  const [state, setState] = useState({ count, voted });
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onClick() {
    const optimistic = { voted: !state.voted, count: state.count + (state.voted ? -1 : 1) };
    const previous = state;
    setState(optimistic);
    setMessage(undefined);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("targetType", targetType);
      fd.set("targetId", targetId);
      const result = await toggleHelpfulAction(null, fd);
      if (!result.ok) {
        setState(previous);
        setMessage(result.message);
      }
    });
  }

  if (disabled) {
    return state.count ? <span className="text-sm text-ink-soft">{state.count} found this helpful</span> : null;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={state.voted}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
          state.voted ? "border-forest bg-forest/10 font-semibold text-forest" : "border-line text-ink-soft hover:border-ink-soft hover:text-ink"
        }`}
      >
        Helpful
        <span className="tabular-nums">{state.count ? `(${state.count})` : ""}</span>
      </button>
      {message ? (
        <span role="status" className="text-sm text-lacquer">
          {message}
        </span>
      ) : null}
    </span>
  );
}
