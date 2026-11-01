import "server-only";
import type { StoreData } from "../store/dev-store";
import { applicationColumns } from "./mappers";
import { Prisma, type PrismaClient } from "./generated/client";

// Copies dev-store data (the seed from buildSeed) into an empty PostgreSQL database in one transaction, so the
// contract tests compare both backends on the same rows. B04 builds prisma/seed.ts on it. B03b and B03c add the
// catalogue, content and commerce tables as their repositories arrive.

const date = (value: string | undefined) => (value === undefined ? undefined : new Date(value));
const json = (value: unknown) =>
  value === undefined ? undefined : value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

export async function loadStoreData(client: PrismaClient, data: StoreData): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.user.createMany({
      data: data.users.map((u) => ({
        ...u,
        mutedUntil: date(u.mutedUntil),
        createdAt: new Date(u.createdAt),
        deletedAt: date(u.deletedAt),
      })),
    });
    await tx.sellerApplication.createMany({
      data: data.applications.map((a) => applicationColumns(a) as Prisma.SellerApplicationCreateManyInput),
    });
    await tx.address.createMany({ data: data.addresses });
    await tx.notification.createMany({
      data: data.notifications.map((n) => ({ ...n, readAt: date(n.readAt), createdAt: new Date(n.createdAt) })),
    });
    await tx.auditLogEntry.createMany({
      data: data.auditLog.map((e) => ({
        ...e,
        before: json(e.before),
        after: json(e.after),
        createdAt: new Date(e.createdAt),
      })),
    });
    await tx.rateEvent.createMany({ data: data.rateEvents.map((e) => ({ ...e, at: new Date(e.at) })) });
  });
}
