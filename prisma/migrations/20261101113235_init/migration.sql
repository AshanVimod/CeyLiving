-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PostingRestriction" AS ENUM ('NONE', 'MUTED', 'BANNED');

-- CreateEnum
CREATE TYPE "CategoryGroup" AS ENUM ('MODERN', 'TRADITIONAL');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('INDIVIDUAL', 'REGISTERED_BUSINESS');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('READY_TO_SHIP', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "Style" AS ENUM ('MODERN', 'TRADITIONAL', 'MINIMAL', 'COLOURFUL', 'RUSTIC', 'CULTURAL');

-- CreateEnum
CREATE TYPE "CustomizationKind" AS ENUM ('TEXT', 'SELECT');

-- CreateEnum
CREATE TYPE "SellerOrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'DISPATCHED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "AnswerAuthorRole" AS ENUM ('SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('PRODUCT', 'SHOP', 'REVIEW', 'QUESTION', 'ANSWER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VoteTargetType" AS ENUM ('REVIEW', 'QUESTION');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "CustomRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "email_verified" BOOLEAN NOT NULL,
    "posting_restriction" "PostingRestriction" NOT NULL,
    "muted_until" TIMESTAMPTZ(3),
    "restriction_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "applicant_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "business_reg_no" TEXT,
    "shop_name" TEXT NOT NULL,
    "craft" TEXT NOT NULL,
    "category_slugs" TEXT[],
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "address_city" TEXT NOT NULL,
    "address_district" TEXT NOT NULL,
    "address_postal_code" TEXT,
    "story" TEXT NOT NULL,
    "work_photo_urls" TEXT[],
    "social_url" TEXT,
    "accepted_terms_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ApplicationStatus" NOT NULL,
    "admin_note" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "postal_code" TEXT,
    "phone" TEXT NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "CategoryGroup" NOT NULL,
    "blurb" TEXT NOT NULL,
    "subcategories" TEXT[],
    "photo_id" TEXT NOT NULL,
    "photo_alt" TEXT NOT NULL,
    "sinhala" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "craft" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "since" INTEGER NOT NULL,
    "is_verified" BOOLEAN NOT NULL,
    "logo_photo_id" TEXT NOT NULL,
    "logo_alt" TEXT NOT NULL,
    "banner_photo_id" TEXT NOT NULL,
    "banner_alt" TEXT NOT NULL,
    "portrait_photo_id" TEXT,
    "portrait_alt" TEXT,
    "dispatch_days" TEXT NOT NULL,
    "return_policy" TEXT NOT NULL,
    "status" "ShopStatus" NOT NULL,
    "status_reason" TEXT,
    "payout_account_masked" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "category_slug" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "materials" TEXT[],
    "material_note" TEXT NOT NULL,
    "styles" "Style"[],
    "tags" TEXT[],
    "type" "ProductType" NOT NULL,
    "processing_days" INTEGER,
    "is_customizable" BOOLEAN NOT NULL,
    "is_heritage" BOOLEAN NOT NULL,
    "is_eco_friendly" BOOLEAN NOT NULL,
    "featured_rank" INTEGER,
    "published_at" DATE NOT NULL,
    "dimensions" TEXT NOT NULL,
    "care" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "photo_id" TEXT NOT NULL,
    "alt" TEXT NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("product_id","position")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "compare_at_price_cents" INTEGER,
    "stock" INTEGER NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("product_id","sku")
);

-- CreateTable
CREATE TABLE "customization_fields" (
    "product_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CustomizationKind" NOT NULL,
    "options" TEXT[],
    "max_length" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL,
    "helper" TEXT,

    CONSTRAINT "customization_fields_pkey" PRIMARY KEY ("product_id","key")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "status" "SellerOrderStatus" NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "courier_name" TEXT,
    "tracking_ref" TEXT,
    "cancel_reason" TEXT,
    "accepted_at" TIMESTAMPTZ(3),
    "dispatched_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "payout_id" TEXT,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "seller_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_sku" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "variant_label" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "refunds_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "reference" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "budget_cents" INTEGER,
    "status" "CustomRequestStatus" NOT NULL,
    "quote_price_cents" INTEGER,
    "quote_days" INTEGER,
    "quote_message" TEXT,
    "quoted_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ContentStatus" NOT NULL,
    "status_reason" TEXT,
    "seller_reply" TEXT,
    "seller_replied_at" TIMESTAMPTZ(3),
    "ceyliving_reply" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_questions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_answers" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_role" "AnswerAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL,
    "resolved_by_id" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpful_votes" (
    "user_id" TEXT NOT NULL,
    "target_type" "VoteTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "helpful_votes_pkey" PRIMARY KEY ("user_id","target_type","target_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "seller_applications_user_id_created_at_idx" ON "seller_applications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_applications_status_created_at_idx" ON "seller_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "seller_applications_decided_by_id_idx" ON "seller_applications"("decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_applications_one_open_per_user" ON "seller_applications"("user_id") WHERE (status IN ('PENDING', 'NEEDS_CHANGES'));

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "rate_events_user_id_kind_at_idx" ON "rate_events"("user_id", "kind", "at");

-- CreateIndex
CREATE INDEX "rate_events_at_idx" ON "rate_events"("at");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE INDEX "shops_owner_id_idx" ON "shops"("owner_id");

-- CreateIndex
CREATE INDEX "shops_status_idx" ON "shops"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shops_one_open_per_owner" ON "shops"("owner_id") WHERE (status <> 'CLOSED');

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_shop_id_status_idx" ON "products"("shop_id", "status");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "products"("status", "published_at");

-- CreateIndex
CREATE INDEX "products_category_slug_idx" ON "products"("category_slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_position_key" ON "product_variants"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "customization_fields_product_id_position_key" ON "customization_fields"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at");

-- CreateIndex
CREATE INDEX "seller_orders_order_id_idx" ON "seller_orders"("order_id");

-- CreateIndex
CREATE INDEX "seller_orders_shop_id_status_idx" ON "seller_orders"("shop_id", "status");

-- CreateIndex
CREATE INDEX "seller_orders_shop_id_updated_at_idx" ON "seller_orders"("shop_id", "updated_at");

-- CreateIndex
CREATE INDEX "seller_orders_payout_id_idx" ON "seller_orders"("payout_id");

-- CreateIndex
CREATE INDEX "seller_orders_status_completed_at_idx" ON "seller_orders"("status", "completed_at");

-- CreateIndex
CREATE INDEX "order_items_seller_order_id_idx" ON "order_items"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "payouts_shop_id_created_at_idx" ON "payouts"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "custom_requests_customer_id_updated_at_idx" ON "custom_requests"("customer_id", "updated_at");

-- CreateIndex
CREATE INDEX "custom_requests_shop_id_updated_at_idx" ON "custom_requests"("shop_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_idx" ON "reviews"("product_id", "status");

-- CreateIndex
CREATE INDEX "reviews_shop_id_created_at_idx" ON "reviews"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_author_id_idx" ON "reviews"("author_id");

-- CreateIndex
CREATE INDEX "product_questions_product_id_status_idx" ON "product_questions"("product_id", "status");

-- CreateIndex
CREATE INDEX "product_questions_shop_id_created_at_idx" ON "product_questions"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "product_questions_author_id_idx" ON "product_questions"("author_id");

-- CreateIndex
CREATE INDEX "product_answers_question_id_created_at_idx" ON "product_answers"("question_id", "created_at");

-- CreateIndex
CREATE INDEX "product_answers_author_id_idx" ON "product_answers"("author_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_status_idx" ON "reports"("target_type", "target_id", "status");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- CreateIndex
CREATE INDEX "reports_resolved_by_id_idx" ON "reports"("resolved_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_one_open_per_reporter" ON "reports"("reporter_id", "target_type", "target_id") WHERE (status = 'OPEN');

-- CreateIndex
CREATE INDEX "helpful_votes_target_type_target_id_idx" ON "helpful_votes"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_events" ADD CONSTRAINT "rate_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "categories"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customization_fields" ADD CONSTRAINT "customization_fields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_answers" ADD CONSTRAINT "product_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "product_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_answers" ADD CONSTRAINT "product_answers_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpful_votes" ADD CONSTRAINT "helpful_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================================================
-- Written by hand (Prisma can't express these). Limits mirror lib/config.ts; change both together.
-- ============================================================================================================

-- DB-07: business limits that must never break, whatever code writes the row.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK (email = lower(email));
ALTER TABLE "users" ADD CONSTRAINT "users_muted_until_only_when_muted"
  CHECK (muted_until IS NULL OR posting_restriction = 'MUTED');

ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_category_count"
  CHECK (cardinality(category_slugs) BETWEEN 1 AND 6);
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_reg_no_only_for_business"
  CHECK (business_reg_no IS NULL OR business_type = 'REGISTERED_BUSINESS');

ALTER TABLE "products" ADD CONSTRAINT "products_processing_days_range"
  CHECK (processing_days IS NULL OR processing_days BETWEEN 1 AND 90);
ALTER TABLE "products" ADD CONSTRAINT "products_materials_known"
  CHECK (materials <@ ARRAY['wood', 'fabric', 'clay', 'resin', 'metal', 'natural-fibre', 'recycled', 'other']::text[]);

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_position_range" CHECK (position BETWEEN 0 AND 7);

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_position_range" CHECK (position BETWEEN 0 AND 9);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_range"
  CHECK (price_cents BETWEEN 100 AND 10000000);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_compare_at_above_price"
  CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents > price_cents);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_range" CHECK (stock BETWEEN 0 AND 9999);

ALTER TABLE "customization_fields" ADD CONSTRAINT "customization_fields_position_range"
  CHECK (position BETWEEN 0 AND 4);
ALTER TABLE "customization_fields" ADD CONSTRAINT "customization_fields_max_length_range"
  CHECK (max_length BETWEEN 1 AND 200);

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_not_negative"
  CHECK (subtotal_cents >= 0 AND shipping_cents >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_adds_up" CHECK (total_cents = subtotal_cents + shipping_cents);

ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_amounts_not_negative"
  CHECK (subtotal_cents >= 0 AND shipping_cents >= 0);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_range" CHECK (quantity BETWEEN 1 AND 20);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_positive" CHECK (unit_price_cents > 0);

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amounts_not_negative"
  CHECK (gross_cents >= 0 AND commission_cents >= 0 AND refunds_cents >= 0);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_net_adds_up"
  CHECK (net_cents = gross_cents - commission_cents - refunds_cents);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_period_order" CHECK (period_end >= period_start);

ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_budget_positive"
  CHECK (budget_cents IS NULL OR budget_cents > 0);
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_quote_complete"
  CHECK ((quote_price_cents IS NULL) = (quote_days IS NULL) AND (quote_price_cents IS NULL) = (quoted_at IS NULL));

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK (rating BETWEEN 1 AND 5);

-- DB-10: the app role gets data access only; it never owns tables or runs migrations. The role is created outside
-- migrations (local: infra/postgres-init; staging/production: the provider's console) with its own password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ceyliving_app') THEN
    CREATE ROLE ceyliving_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ceyliving_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ceyliving_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ceyliving_app;
-- Tables and sequences added by later migrations get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ceyliving_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ceyliving_app;

-- DB-09 / SEC-A9: the audit log is append-only for the app.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM ceyliving_app;
-- Prisma's own bookkeeping table is for the migrator only (it doesn't exist when Prisma replays this file).
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM ceyliving_app;
  END IF;
END
$$;
