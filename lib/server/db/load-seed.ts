import "server-only";
import { categories } from "@/lib/data/categories";
import type { SeedData } from "@/prisma/seed-data";
import {
  applicationColumns,
  customizationRows,
  customRequestColumns,
  imageRows,
  orderColumns,
  payoutColumns,
  productColumns,
  reviewColumns,
  sellerOrderColumns,
  shopColumns,
  toCategoryColumns,
  variantRows,
  withDates,
} from "./mappers";
import { Prisma, type PrismaClient } from "./generated/client";

// Copies the demo data (prisma/seed-data.ts) and the launch categories into PostgreSQL in one transaction. Used by
// `npm run db:seed` (prisma/seed.ts) and by the tests, which load it before every test.
//
// Repeatable: with `replace` every table is emptied first, inside the same transaction, so running it twice gives
// the same rows, never duplicates. Without `replace` it refuses a database that already has users. Emptying tables
// needs the schema owner (ceyliving_migrator), and it is refused outright in production.

const json = (value: unknown) =>
  value === undefined ? undefined : value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

type Create<T> = T extends { createMany(args: { data: infer D }): unknown } ? D : never;
const rows = <T>(data: Record<string, unknown>[]) => data as unknown as Create<T>;

export async function loadStoreData(
  client: PrismaClient,
  data: SeedData,
  opts: { replace?: boolean } = {},
): Promise<void> {
  if (opts.replace && process.env.NODE_ENV === "production") {
    throw new Error("loadStoreData refuses to replace data in production.");
  }
  const shopIdOf = new Map(data.shops.map((s) => [s.slug, s.id]));

  // A bulk load: allowed more time than an app transaction (Prisma's default is 5 seconds), so it also finishes
  // when many test files load the demo data at once.
  await client.$transaction(
    async (tx) => {
      if (opts.replace) {
        const tables = await tx.$queryRaw<{ name: string }[]>`
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
        await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.name}"`).join(", ")} RESTART IDENTITY`);
      } else if ((await tx.user.count()) > 0) {
        throw new Error("The database already has data: pass { replace: true } to load the seed again.");
      }

      // Parents before children, so every foreign key finds its row.
      await tx.category.createMany({ data: categories.map(toCategoryColumns) });
      await tx.user.createMany({
        data: rows<typeof tx.user>(data.users.map((u) => withDates(u, ["mutedUntil", "createdAt", "deletedAt"]))),
      });
      await tx.sellerApplication.createMany({
        data: rows<typeof tx.sellerApplication>(data.applications.map(applicationColumns)),
      });
      await tx.address.createMany({ data: data.addresses });
      await tx.notification.createMany({
        data: rows<typeof tx.notification>(data.notifications.map((n) => withDates(n, ["readAt", "createdAt"]))),
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

      await tx.shop.createMany({ data: rows<typeof tx.shop>(data.shops.map(shopColumns)) });
      await tx.product.createMany({
        data: rows<typeof tx.product>(
          data.products.map((p) => ({ ...productColumns(p), shopId: shopIdOf.get(p.shopSlug) })),
        ),
      });
      await tx.productImage.createMany({ data: data.products.flatMap((p) => imageRows(p.id, p.images)) });
      await tx.productVariant.createMany({ data: data.products.flatMap((p) => variantRows(p.id, p.variants)) });
      await tx.customizationField.createMany({
        data: data.products.flatMap((p) => customizationRows(p.id, p.customization ?? [])),
      });

      await tx.order.createMany({ data: rows<typeof tx.order>(data.orders.map(orderColumns)) });
      await tx.payout.createMany({ data: rows<typeof tx.payout>(data.payouts.map(payoutColumns)) });
      await tx.sellerOrder.createMany({ data: rows<typeof tx.sellerOrder>(data.sellerOrders.map(sellerOrderColumns)) });
      await tx.orderItem.createMany({ data: data.orderItems });
      await tx.customRequest.createMany({
        data: rows<typeof tx.customRequest>(data.customRequests.map(customRequestColumns)),
      });

      await tx.review.createMany({ data: rows<typeof tx.review>(data.reviews.map(reviewColumns)) });
      await tx.productQuestion.createMany({
        data: rows<typeof tx.productQuestion>(data.questions.map((q) => withDates(q, ["createdAt"]))),
      });
      await tx.productAnswer.createMany({
        data: rows<typeof tx.productAnswer>(data.answers.map((a) => withDates(a, ["createdAt"]))),
      });
      await tx.report.createMany({
        data: rows<typeof tx.report>(data.reports.map((r) => withDates(r, ["createdAt"]))),
      });
      await tx.helpfulVote.createMany({
        data: rows<typeof tx.helpfulVote>(data.helpfulVotes.map((v) => withDates(v, ["createdAt"]))),
      });
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
}
