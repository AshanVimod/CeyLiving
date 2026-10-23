type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-sage text-ink",
  positive: "bg-forest/12 text-forest",
  warning: "bg-turmeric-soft text-ink",
  danger: "bg-lacquer/10 text-lacquer",
  info: "bg-paper-raised text-ink border border-line",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  // applications
  PENDING: { label: "Pending review", tone: "warning" },
  NEEDS_CHANGES: { label: "Changes requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  // shops
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "positive" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  CLOSED: { label: "Closed", tone: "neutral" },
  // products
  PENDING_REVIEW: { label: "Waiting for approval", tone: "warning" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "danger" },
  // content
  VISIBLE: { label: "Visible", tone: "positive" },
  HIDDEN: { label: "Hidden", tone: "warning" },
  DELETED: { label: "Deleted", tone: "danger" },
  // orders
  NEW: { label: "New", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "info" },
  IN_PROGRESS: { label: "Being made", tone: "info" },
  DISPATCHED: { label: "Dispatched", tone: "warning" },
  COMPLETED: { label: "Delivered", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  // reports and users
  OPEN: { label: "Open", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "positive" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
  MUTED: { label: "Muted", tone: "warning" },
  BANNED: { label: "Banned", tone: "danger" },
  NONE: { label: "Can post", tone: "positive" },
};

/** Status shown as words, never by colour alone. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ${tones[s.tone]}`}
    >
      {label ?? s.label}
    </span>
  );
}

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}
