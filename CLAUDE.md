@AGENTS.md

## Repository and git rules

These apply to every session.

- **Two folders:** this repo is checked out in two folders.
  - `ceyliving-f01` has `Feature-01`, the real product. All B and CR tasks happen here, and backend work always does.
  - `ceyliving` has `Feature-02`, the public demo only.
- **Commits:** always show the diff and wait for approval before committing.
- **Pushes:** never push without asking first.

## Backend rules

The backend follows `docs/backend-plan.docx`. It builds on `docs/build-spec.docx` (BR-, CS-, SEC-) and `docs/feature-spec.docx` (FR-, RULE-, SEC-A).

- **The contract:** the plan's rule IDs (BE-, DB-, AU-, PAY-, JOB-, OPS-) and the earlier rules (BR-, CS-, SEC-, RULE-, SEC-A) are the contract. Name the rule ID in every test, for example `PAY-04 ignores a repeated notification`.
- **Where it lives:** the backend lives inside this Next.js app plus one worker process.
- **Layering:** keep the layering: server action -> service -> repository. Only repositories touch the database.
- **Next.js:** read `node_modules/next/dist/docs/` before using any Next.js API (this version has breaking changes).
- **Skills:** apply these Backend Design skills to every backend task:
  - `backend-design:think-before-coding`
  - `backend-design:data-modeling-discipline`
  - `backend-design:migration-safety`
  - `backend-design:query-discipline`
  - `backend-design:idempotency-and-side-effects`
  - `backend-design:error-handling-as-design`
  - `backend-design:auth-and-authorization`
  - `backend-design:security-discipline`
  - `backend-design:observability-by-default`
  - `backend-design:testing-with-discernment`
  - `backend-design:boring-by-default`
- **Trust nothing from the browser:** never trust IDs, prices, roles or status from the browser. Validate all input with zod.
- **Transactions:** money, stock, role and status changes run in one transaction.
- **Process:** every task is designed first, then waits for approval, then gets built.
- **Finish with `npm run check`:** it runs lint, typecheck and tests.
- **Scope:** one task per session. Change nothing outside the task.
