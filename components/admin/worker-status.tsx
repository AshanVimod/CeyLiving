import type { WorkerHealth } from "@/lib/server/services/email-admin";

function minutesAgo(date: Date, now: number) {
  const minutes = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  return minutes < 1 ? "less than a minute ago" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

/** The worker sends every email: say plainly whether it is running. */
export function WorkerStatus({ health, now }: { health: WorkerHealth; now: number }) {
  const seen = health.lastSeen ? minutesAgo(health.lastSeen, now) : undefined;
  if (health.workerSilent)
    return (
      <p role="alert" className="mb-8 rounded-lg border border-lacquer/50 bg-lacquer/10 p-4">
        <strong>The worker isn’t running.</strong>{" "}
        {seen ? `It was last seen ${seen}.` : "It has never run against this database."} Emails, payouts and other
        background jobs wait until it starts again.
      </p>
    );
  return (
    <p className="mb-8 rounded-lg border border-line bg-paper-raised p-4">
      The worker is running (last seen {seen}).{" "}
      {health.stuckEmails
        ? `${health.stuckEmails} email${health.stuckEmails === 1 ? " has" : "s have"} waited more than 30 minutes.`
        : "No email is waiting longer than it should."}
    </p>
  );
}
