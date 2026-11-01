# ADR 0001: The database schema grows with each task

- **Status:** Accepted
- **Date:** 24 October 2026
- **Task:** B03 (Prisma schema and PostgreSQL repositories)

## Context

Section 7.2 of `docs/backend-plan.docx` lists every table the finished marketplace needs, and the B03 prompt asks for
all of them in the first migration. Many have no code yet: the Better Auth tables (B05), the order payment columns
(B07), payments and refunds (B08), uploads (B09) and shop payout accounts (B11). Some rows of 7.2 also predate the
current domain types (for example seller applications before FR-2a).

## Decision

- B03's first migration creates only the tables that today's repositories use, plus `categories` (products reference
  it by foreign key).
- The schema follows the current `lib/types.ts` where 7.2 differs from it.
- Each later task adds its own tables and columns in its own migration, with the code and tests that use them
  (expand, then contract, DB-11).
- Prisma packages are pinned to 7.10.1, the last stable release; npm's `latest` tag pointed to an 8.0 release
  candidate when B03 was designed.

## Consequences

- Every table in the database has code and tests behind it, and no column is guessed before its feature is designed.
- The schema is built from several small migrations rather than one, so each one stays easy to review.
- Section 7.2 stays the target. A task that adds a table checks it against 7.2 and the domain types at that time.
