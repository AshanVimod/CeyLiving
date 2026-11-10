-- B13 (backend plan 14): grows a load-test database to the target size, about 1,000 public items with 5 visible
-- reviews each, by copying the demo items. For `npm run load:k6` only. See README, "Performance and caching".
--
-- Run it on a database made for the test, never the development or a real one (it refuses any name that doesn't
-- end in _perf), after migrations and the demo data:
--   DATABASE_MIGRATION_URL=<the _perf database, as its owner> npx prisma db execute --file scripts/load/grow-catalogue.sql
-- Running it twice fails on the copies' IDs and changes nothing (one transaction).

DO $$
BEGIN
  IF current_database() NOT LIKE '%\_perf' THEN
    RAISE EXCEPTION 'grow-catalogue.sql only runs on a database whose name ends in _perf, not %', current_database();
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE src ON COMMIT DROP AS SELECT * FROM products WHERE status = 'ACTIVE';
CREATE TEMP TABLE n ON COMMIT DROP AS
  SELECT g FROM generate_series(1, (SELECT ceil(1000.0 / count(*))::int - 1 FROM src)) g;

INSERT INTO products (id, shop_id, category_slug, subcategory, slug, title, description, materials, material_note,
  styles, tags, type, processing_days, is_customizable, is_heritage, is_eco_friendly, featured_rank, published_at,
  dimensions, care, status, created_at, updated_at)
SELECT s.id || '-x' || n.g, s.shop_id, s.category_slug, s.subcategory, s.slug || '-x' || n.g, s.title || ' No. ' || n.g,
  s.description, s.materials, s.material_note, s.styles, s.tags, s.type, s.processing_days, s.is_customizable,
  s.is_heritage, s.is_eco_friendly, NULL, s.published_at - n.g, s.dimensions, s.care, 'ACTIVE', now(), now()
FROM src s CROSS JOIN n;

INSERT INTO product_images (product_id, position, photo_id, alt)
SELECT i.product_id || '-x' || n.g, i.position, i.photo_id, i.alt
FROM product_images i JOIN src s ON s.id = i.product_id CROSS JOIN n;

INSERT INTO product_variants (product_id, sku, position, label, price_cents, compare_at_price_cents, stock)
SELECT v.product_id || '-x' || n.g, v.sku, v.position, v.label, v.price_cents + n.g * 100, v.compare_at_price_cents, v.stock
FROM product_variants v JOIN src s ON s.id = v.product_id CROSS JOIN n;

INSERT INTO customization_fields (product_id, key, position, label, kind, options, max_length, is_required, helper)
SELECT c.product_id || '-x' || n.g, c.key, c.position, c.label, c.kind, c.options, c.max_length, c.is_required, c.helper
FROM customization_fields c JOIN src s ON s.id = c.product_id CROSS JOIN n;

INSERT INTO reviews (id, product_id, shop_id, order_item_id, author_id, author_name, rating, comment, status, created_at)
SELECT 'rv-' || p.id || '-' || k, p.id, p.shop_id, NULL, (SELECT id FROM users ORDER BY id LIMIT 1), 'Load test',
  3 + (k % 3), 'Lovely piece.', 'VISIBLE', now() - (k || ' days')::interval
FROM products p CROSS JOIN generate_series(1, 5) k
WHERE p.id IN (SELECT s.id || '-x' || n.g FROM src s CROSS JOIN n);

COMMIT;

ANALYZE;
