import Image from "next/image";
import { db } from "@/lib/server/db/tx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { ApplicationDecisions } from "@/components/admin/application-decisions";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCategory } from "@/lib/data/categories";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { findApplicationById, findUserById } from "@/lib/server/repositories/people";
import { photoIdFromUrl } from "@/lib/validation/photo";

export const metadata = { title: "Application" };

async function Application({ params }: { params: PageProps<"/admin/applications/[id]">["params"] }) {
  await requireRole(["ADMIN"], "/admin/applications");
  const { id } = await params;
  const app = await findApplicationById(db, id);
  if (!app) notFound();
  const applicant = await findUserById(db, app.userId);
  const decider = app.decidedById ? await findUserById(db, app.decidedById) : undefined;
  const { address } = app;
  const rows: [string, React.ReactNode][] = [
    ["Account", `${applicant?.name ?? "Unknown"} (${applicant?.email ?? ""})`],
    ["Full name", app.applicantName || "Not given"],
    ["Phone", app.phone],
    ["Sells as", app.businessType === "REGISTERED_BUSINESS" ? "A registered business" : "An individual maker"],
    ...(app.businessType === "REGISTERED_BUSINESS"
      ? [["Registration number", app.businessRegNo ?? "Not given"] as [string, React.ReactNode]]
      : []),
    ["Craft", app.craft],
    ["Categories", app.categorySlugs.map((slug) => getCategory(slug)?.name ?? slug).join(", ")],
    [
      "Shop address",
      address.line1
        ? [address.line1, address.line2, address.city, address.district, address.postalCode].filter(Boolean).join(", ")
        : `Not given (district: ${address.district})`,
    ],
    [
      "Social page",
      app.socialUrl ? (
        <a href={app.socialUrl} rel="noopener noreferrer nofollow" target="_blank" className="text-forest underline">
          {app.socialUrl}
        </a>
      ) : (
        "None"
      ),
    ],
    ["Terms accepted", formatDate(app.acceptedTermsAt)],
    ["Submitted", formatDate(app.createdAt)],
  ];
  return (
    <>
      <p className="mb-3">
        <Link href="/admin/applications" className="text-sm font-semibold text-forest underline underline-offset-4">
          All applications
        </Link>
      </p>
      <PageTitle title={app.shopName} action={<StatusBadge status={app.status} />} />
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-paper-raised p-5 sm:grid-cols-[160px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-ink-soft [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="story-h" className="mt-6">
        <h2 id="story-h" className="text-xl">
          Their story
        </h2>
        <p className="mt-2 max-w-prose whitespace-pre-line text-ink-soft">{app.story}</p>
      </section>
      <section aria-labelledby="photos-h" className="mt-6">
        <h2 id="photos-h" className="text-xl">
          Work photos
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {app.workPhotoUrls.map((url, i) => {
            const photoId = photoIdFromUrl(url);
            return (
              <li key={`${url}-${i}`} className="relative aspect-square overflow-hidden rounded-md bg-sage">
                {photoId ? (
                  <Image
                    src={`https://images.unsplash.com/photo-${photoId}`}
                    alt={`Work photo ${i + 1} from ${app.shopName}`}
                    fill
                    sizes="200px"
                    className="object-cover"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      {app.adminNote ? (
        <p className="mt-6 rounded-md bg-sage px-4 py-3">
          <span className="font-semibold">Note sent{decider ? ` by ${decider.name}` : ""}: </span>
          {app.adminNote}
        </p>
      ) : null}
      <div className="mt-8 border-t border-line pt-6">
        {app.status === "PENDING" ? (
          <ApplicationDecisions applicationId={app.id} shopName={app.shopName} />
        ) : (
          <p className="text-ink-soft">
            {app.status === "NEEDS_CHANGES"
              ? "Waiting for the applicant to update the application."
              : `Decided${app.decidedAt ? ` on ${formatDate(app.decidedAt)}` : ""}.`}
          </p>
        )}
      </div>
    </>
  );
}

export default function AdminApplicationPage(props: PageProps<"/admin/applications/[id]">) {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
      <Application params={props.params} />
    </Suspense>
  );
}
