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
import { StoreUnavailableError } from "../errors";
import { buildSeed, SEED_TIME } from "./seed";

export const STORE_VERSION = 2;

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
// In production it serves the seed read-only and refuses every write (SEC-A8).

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function storePath(): string {
  // The ignore comment stops the bundler from tracing the whole project for this runtime-only path.
  return process.env.CEYLIVING_STORE_PATH ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "dev-store.json");
}

let cache: { file: string; mtimeMs: number; data: StoreData } | null = null;
let productionSeed: StoreData | null = null;
let queue: Promise<unknown> = Promise.resolve();

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

/** Upgrades an older store file in place so people keep their test data; unknown versions are reseeded. */
function migrate(data: StoreData): StoreData {
  if (data.version === 1) {
    return { ...data, version: 2, payouts: data.payouts ?? [], customRequests: data.customRequests ?? [], helpfulVotes: data.helpfulVotes ?? [] };
  }
  return buildSeed(new Date());
}

/** Current data, read-only. Callers must not mutate it; use `transaction` to write. */
export function readStore(): StoreData {
  if (isProductionRuntime()) return (productionSeed ??= deepFreeze(buildSeed(new Date(SEED_TIME))));
  return loadFromDisk(storePath());
}

/**
 * Runs `fn` against a private copy and writes it only if `fn` returns without throwing,
 * so multi-step changes (RULE-A3) are all-or-nothing. Writes run one at a time.
 */
export function transaction<T>(fn: (draft: StoreData) => T): Promise<T> {
  if (isProductionRuntime()) return Promise.reject(new StoreUnavailableError());
  const run = async () => {
    const file = storePath();
    const draft = structuredClone(loadFromDisk(file)) as StoreData;
    const result = fn(draft);
    writeAtomic(file, draft);
    cache = null;
    return result;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Test helper: forget the cached copy and delete the file so the next read reseeds. */
export function resetStoreForTests() {
  cache = null;
  const file = storePath();
  if (fs.existsSync(file)) fs.rmSync(file);
}
