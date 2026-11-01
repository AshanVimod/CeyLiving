-- B04b: full-text search on the public catalogue (backend plan 7.3), and pg_trgm for typo-tolerant suggestions.
-- Only adds things: the app keeps working on the previous version until it is deployed (DB-11, expand step).
-- Adding a STORED generated column rewrites each table once; at today's size (tens of rows) that takes milliseconds.

-- A trusted extension since PostgreSQL 13, so the database owner (ceyliving_migrator) can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- array_to_string is only STABLE, so a generated column can't call it. For text[] it never changes its answer,
-- which makes this wrapper safe to mark IMMUTABLE.
CREATE FUNCTION ceyliving_join_words(words text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string(words, ' ') $$;

-- The 'simple' configuration lowercases and splits words without English stemming, so English and Sinhala are both
-- indexed as written. Weights: title A; tags, materials and subcategory B; description and material note C.
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', "title"), 'A') ||
  setweight(to_tsvector('simple', ceyliving_join_words("tags") || ' ' || ceyliving_join_words("materials") || ' ' || "subcategory"), 'B') ||
  setweight(to_tsvector('simple', "description" || ' ' || "material_note"), 'C')
) STORED;
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");
-- Typo-tolerant suggestions compare titles by similarity().
CREATE INDEX "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);

-- Search also finds items through their shop's name and their category's English or Sinhala name. (Not the shop's
-- craft: "wood" would then return every item of a wood-carving shop.)
ALTER TABLE "shops" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', "name")
) STORED;
CREATE INDEX "shops_search_vector_idx" ON "shops" USING GIN ("search_vector");

ALTER TABLE "categories" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', "name" || ' ' || coalesce("sinhala", ''))
) STORED;
