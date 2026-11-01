import type { Tx } from "../../db/tx";
import type { PgTx } from "../../db/pg";
import type * as devCatalogue from "../catalogue";
import type * as devContent from "../content";
import type * as devPeople from "../people";
import type * as pgCatalogue from "./catalogue";
import type * as pgContent from "./content";
import type * as pgPeople from "./people";

// Type-only check, run by `npm run typecheck`: each PostgreSQL repository exports exactly the dev-store module's
// functions, with PgTx in place of Tx. A missing function or a changed signature fails the build.

type OnPg<M> = {
  [K in keyof M]: M[K] extends (tx: Tx, ...args: infer A) => infer R ? (tx: PgTx, ...args: A) => R : M[K];
};
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type PeopleConforms = Assert<Same<OnPg<typeof devPeople>, typeof pgPeople>>;
export type CatalogueConforms = Assert<Same<OnPg<typeof devCatalogue>, typeof pgCatalogue>>;
export type ContentConforms = Assert<Same<OnPg<typeof devContent>, typeof pgContent>>;
