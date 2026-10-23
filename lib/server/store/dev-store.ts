import "server-only";
import fs from "node:fs";
import path from "node:path";
import type {
  Address,
  CustomRequest,
  HelpfulVote,
  Payout,
  AuditLogEntry,
  Notification,
  Order,
  OrderItem,
  Product,
  ProductAnswer,
  ProductQuestion,
  RateEvent,
  Report,
  Review,
  SellerApplication,
  SellerOrder,
  Shop,
  User,
} from "@/lib/types";
import { DEMO_RESET_HOURS } from "@/lib/config";
import { StoreUnavailableError } from "../errors";
import { demoSignInAllowed, isDemoMode, isProductionRuntime } from "../runtime";
import { buildSeed, SEED_TIME } from "./seed";

export const STORE_VERSION = 3;

export interface StoreData {
  version: number;
  users: User[];
  applications: SellerApplication[];
  shops: Shop[];
  products: Product[];
  orders: Order[];
  sellerOrders: SellerOrder[];
  orderItems: OrderItem[];
  reviews: Review[];
  questions: ProductQuestion[];
  answers: ProductAnswer[];
  reports: Report[];
  auditLog: AuditLogEntry[];
  notifications: Notification[];
  addresses: Address[];
  rateEvents: RateEvent[];
  payouts: Payout[];
  customRequests: CustomRequest[];
  helpfulVotes: HelpfulVote[];
}

// A development stepping stone (feature spec 7.4): one JSON file, serialised atomic writes.
// In production it serves the seed read-only and refuses every write (SEC-A8), unless the deployment is the
// public demo (DEMO_MODE=true, Feature-02): then it keeps changes in memory and starts again from a fresh seed,
// dated to the current time, every DEMO_RESET_HOURS.

export { demoSignInAllowed, isDemoMode, isProductionRuntime };

function isDemoProduction(): boolean {
  return isProductionRuntime() && isDemoMode();
}

function storePath(): string {
  // The ignore comment stops the bundler from tracing the whole project for this runtime-only path.
  return (
    process.env.CEYLIVING_STORE_PATH ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "dev-store.json")
  );
}

let cache: { file: string; mtimeMs: number; data: StoreData } | null = null;
let productionSeed: StoreData | null = null;
let demoMemory: { window: number; data: StoreData } | null = null;
let queue: Promise<unknown> = Promise.resolve();

const DEMO_RESET_MS = DEMO_RESET_HOURS * 3_600_000;

/**
 * Wall-clock time for the demo seed. Next.js refuses Date.now() while prerendering but doesn't guard performance,
 * and timeOrigin + now() is the current time. Replaceable in tests.
 */
let demoClock = () => performance.timeOrigin + performance.now();

/** Test helper: pin the demo clock (epoch ms), or pass null to use the real one again. */
export function setDemoClockForTests(clock: (() => number) | null) {
  demoClock = clock ?? (() => performance.timeOrigin + performance.now());
  demoMemory = null;
}

/**
 * The demo's in-memory data. Time is split into DEMO_RESET_HOURS windows; each window starts from a fresh seed
 * built as of the window's start, so its dates stay current (the muted customer stays muted, the delivered order
 * stays reviewable, payouts stay on hold) and every server instance in the same window builds the same data.
 */
function demoState(): { window: number; data: StoreData } {
  const window = Math.floor(demoClock() / DEMO_RESET_MS);
  if (!demoMemory || demoMemory.window !== window) {
    demoMemory = { window, data: deepFreeze(buildSeed(new Date(window * DEMO_RESET_MS))) };
  }
  return demoMemory;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function writeAtomic(file: string, data: StoreData) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function loadFromDisk(file: string): StoreData {
  if (!fs.existsSync(file)) writeAtomic(file, buildSeed(new Date()));
  const { mtimeMs } = fs.statSync(file);
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.data;
  let data = JSON.parse(fs.readFileSync(file, "utf8")) as StoreData;
  if (data.version !== STORE_VERSION) {
    data = migrate(data);
    writeAtomic(file, data);
  }
  cache = { file, mtimeMs: fs.statSync(file).mtimeMs, data: deepFreeze(data) };
  return cache.data;
}

/** A version-2 application: one category and a district, before FR-2a asked for the applicant and an address. */
type ApplicationV2 = Omit<SellerApplication, "applicantName" | "businessType" | "categorySlugs" | "address"> & {
  categorySlug: string;
  district: string;
};

/** Upgrades an older store file in place, one version at a time, so people keep their test data. */
export function migrate(data: StoreData): StoreData {
  let current = data;
  if (current.version === 1) {
    current = {
      ...current,
      version: 2,
      payouts: current.payouts ?? [],
      customRequests: current.customRequests ?? [],
      helpfulVotes: current.helpfulVotes ?? [],
    };
  }
  if (current.version === 2) {
    // v3 (FR-2a): applications name the applicant, list categories and give an address. Old ones keep what they had.
    const names = new Map(current.users.map((u) => [u.id, u.name]));
    current = {
      ...current,
      version: 3,
      applications: (current.applications as unknown as ApplicationV2[]).map(({ categorySlug, district, ...rest }) => ({
        ...rest,
        applicantName: names.get(rest.userId) ?? "",
        businessType: "INDIVIDUAL" as const,
        categorySlugs: [categorySlug],
        address: { line1: "", city: "", district },
      })),
    };
  }
  return current.version === STORE_VERSION ? current : buildSeed(new Date());
}

/** Current data, read-only. Callers must not mutate it; use `transaction` to write. */
export function readStore(): StoreData {
  if (isDemoProduction()) return demoState().data;
  if (isProductionRuntime()) return (productionSeed ??= deepFreeze(buildSeed(new Date(SEED_TIME))));
  return loadFromDisk(storePath());
}

/**
 * Runs `fn` against a private copy and writes it only if `fn` returns without throwing,
 * so multi-step changes (RULE-A3) are all-or-nothing. Writes run one at a time.
 */
export function transaction<T>(fn: (draft: StoreData) => T | Promise<T>): Promise<T> {
  if (isDemoProduction()) return enqueue(() => commitToMemory(fn));
  if (isProductionRuntime()) return Promise.reject(new StoreUnavailableError());
  return enqueue(async () => {
    const file = storePath();
    const draft = structuredClone(loadFromDisk(file)) as StoreData;
    const result = await fn(draft);
    writeAtomic(file, draft);
    cache = null;
    return result;
  });
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Same all-or-nothing rule as the file store, but the new copy replaces the memory; nothing touches the disk. */
async function commitToMemory<T>(fn: (draft: StoreData) => T | Promise<T>): Promise<T> {
  const { window, data } = demoState();
  const draft = structuredClone(data) as StoreData;
  const result = await fn(draft);
  // Freeze a copy, like the file store's re-read, so what `fn` returns stays the caller's to change.
  demoMemory = { window, data: deepFreeze(structuredClone(draft)) };
  return result;
}

/** Test helper: forget the cached copy and delete the file so the next read reseeds. */
export function resetStoreForTests() {
  cache = null;
  demoMemory = null;
  const file = storePath();
  if (fs.existsSync(file)) fs.rmSync(file);
}
