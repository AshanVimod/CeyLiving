import "server-only";
import { getEnv, type Env } from "@/lib/env";
import { localStorage } from "./local";
import { r2Storage } from "./r2";

export * from "./storage";

/** B09: the storage driver chosen by STORAGE_DRIVER (production refuses `local`, lib/env.ts). */
export function getStorage(env: Env = getEnv()) {
  return env.STORAGE_DRIVER === "r2" ? r2Storage(env) : localStorage(env);
}
