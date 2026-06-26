import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "~/db/client";
import type { AllocateConfig } from "./allocate-courts";

/* ---------- Schemas ---------- */

export const PriceTableSchema = z.object({
  thang: z.object({ nam: z.number().int().nonnegative(), nu: z.number().int().nonnegative() }),
  vang_lai: z.object({ nam: z.number().int().nonnegative(), nu: z.number().int().nonnegative() }),
});
export type PriceTable = z.infer<typeof PriceTableSchema>;

export const CourtPrioritySchema = z.array(
  z.object({
    code: z.string().min(1),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    maxHours: z.number().positive(),
  }),
);
export const CourtsByWeekdaySchema = z.object({
  T7: CourtPrioritySchema,
  CN: CourtPrioritySchema,
});
export type CourtsByWeekday = z.infer<typeof CourtsByWeekdaySchema>;

/* ---------- Keys & defaults ---------- */

export const CONFIG_KEYS = {
  PRICES: "prices",
  COURTS_BY_WEEKDAY: "courts_by_weekday",
  PEOPLE_PER_HOUR: "people_per_hour",
  MIN_PEOPLE_PER_SESSION: "min_people_per_session",
  ADMIN_QR_IMAGE_KEY: "admin_qr_image_key",
  QUY_MOMO_LINK: "quy_momo_link",
  VOTE_OPEN_DAY: "vote_open_day",
  VOTE_CLOSE_DAY: "vote_close_day",
  /** Which weekdays the group plays. When a new month is created, only
   * dates matching these weekdays are seeded as play sessions. Schema enum
   * only allows T7 / CN today so this is effectively a 2-checkbox toggle. */
  ACTIVE_WEEKDAYS: "active_weekdays",
} as const;

export type ActiveWeekday = "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "CN";

const ALL_WEEKDAYS: readonly ActiveWeekday[] = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

export const DEFAULT_PRICES: PriceTable = {
  thang: { nam: 60000, nu: 50000 },
  vang_lai: { nam: 70000, nu: 60000 },
};

export const DEFAULT_COURTS: CourtsByWeekday = {
  CN: [
    { code: "B2", endTime: "10:00", maxHours: 2 },
    { code: "B1", endTime: "10:00", maxHours: 2 },
    { code: "B4", endTime: "10:00", maxHours: 2 },
  ],
  T7: [
    { code: "C3", endTime: "10:00", maxHours: 2 },
    { code: "C4", endTime: "10:00", maxHours: 2 },
    { code: "B4", endTime: "10:00", maxHours: 2 },
  ],
};

export const DEFAULT_PEOPLE_PER_HOUR = 3;
export const DEFAULT_MIN_PEOPLE = 6;
export const DEFAULT_VOTE_OPEN_DAY = 5;
export const DEFAULT_VOTE_CLOSE_DAY = 25;
export const DEFAULT_ACTIVE_WEEKDAYS: ActiveWeekday[] = ["T7", "CN"];

/* ---------- Read / write ---------- */

async function readJson<T>(d1: D1Database, key: string, fallback: T): Promise<T> {
  const db = getDb(d1);
  const row = await db.query.config.findFirst({ where: eq(schema.config.key, key) });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(d1: D1Database, key: string, value: unknown): Promise<void> {
  const db = getDb(d1);
  const json = JSON.stringify(value);
  const now = Date.now();
  await db
    .insert(schema.config)
    .values({ key, value: json, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.config.key,
      set: { value: json, updatedAt: now },
    });
}

export async function getPrices(d1: D1Database): Promise<PriceTable> {
  return readJson(d1, CONFIG_KEYS.PRICES, DEFAULT_PRICES);
}

export async function setPrices(d1: D1Database, prices: PriceTable): Promise<void> {
  PriceTableSchema.parse(prices);
  await writeJson(d1, CONFIG_KEYS.PRICES, prices);
}

export async function getCourts(d1: D1Database): Promise<CourtsByWeekday> {
  return readJson(d1, CONFIG_KEYS.COURTS_BY_WEEKDAY, DEFAULT_COURTS);
}

export async function setCourts(d1: D1Database, courts: CourtsByWeekday): Promise<void> {
  CourtsByWeekdaySchema.parse(courts);
  await writeJson(d1, CONFIG_KEYS.COURTS_BY_WEEKDAY, courts);
}

function isWeekday(w: unknown): w is ActiveWeekday {
  return typeof w === "string" && (ALL_WEEKDAYS as readonly string[]).includes(w);
}

export async function getActiveWeekdays(d1: D1Database): Promise<ActiveWeekday[]> {
  const raw = await readJson<ActiveWeekday[]>(
    d1,
    CONFIG_KEYS.ACTIVE_WEEKDAYS,
    DEFAULT_ACTIVE_WEEKDAYS,
  );
  const ok = raw.filter(isWeekday);
  return ok.length === 0 ? DEFAULT_ACTIVE_WEEKDAYS : ok;
}

export async function setActiveWeekdays(
  d1: D1Database,
  weekdays: ActiveWeekday[],
): Promise<void> {
  const cleaned = Array.from(new Set(weekdays.filter(isWeekday)));
  if (cleaned.length === 0) {
    throw new Error("Chọn ít nhất 1 thứ trong tuần.");
  }
  await writeJson(d1, CONFIG_KEYS.ACTIVE_WEEKDAYS, cleaned);
}

export async function getNumber(
  d1: D1Database,
  key: string,
  fallback: number,
): Promise<number> {
  const n = await readJson<number>(d1, key, fallback);
  return typeof n === "number" ? n : fallback;
}

export async function setNumber(d1: D1Database, key: string, value: number): Promise<void> {
  await writeJson(d1, key, value);
}

export async function getString(
  d1: D1Database,
  key: string,
  fallback: string,
): Promise<string> {
  return readJson<string>(d1, key, fallback);
}

export async function setString(d1: D1Database, key: string, value: string): Promise<void> {
  await writeJson(d1, key, value);
}

/** Bundle for the allocation algorithm. */
export async function getAllocateConfig(d1: D1Database): Promise<AllocateConfig> {
  const [courts, ppl, min] = await Promise.all([
    getCourts(d1),
    getNumber(d1, CONFIG_KEYS.PEOPLE_PER_HOUR, DEFAULT_PEOPLE_PER_HOUR),
    getNumber(d1, CONFIG_KEYS.MIN_PEOPLE_PER_SESSION, DEFAULT_MIN_PEOPLE),
  ]);
  return { courtsByWeekday: courts, peoplePerHour: ppl, minPeoplePerSession: min };
}

/** Seed defaults if missing. */
export async function seedDefaults(d1: D1Database): Promise<void> {
  const db = getDb(d1);
  const existing = await db.select({ key: schema.config.key }).from(schema.config);
  const have = new Set(existing.map((r) => r.key));
  const writes: Array<[string, unknown]> = [];
  if (!have.has(CONFIG_KEYS.PRICES)) writes.push([CONFIG_KEYS.PRICES, DEFAULT_PRICES]);
  if (!have.has(CONFIG_KEYS.COURTS_BY_WEEKDAY))
    writes.push([CONFIG_KEYS.COURTS_BY_WEEKDAY, DEFAULT_COURTS]);
  if (!have.has(CONFIG_KEYS.PEOPLE_PER_HOUR))
    writes.push([CONFIG_KEYS.PEOPLE_PER_HOUR, DEFAULT_PEOPLE_PER_HOUR]);
  if (!have.has(CONFIG_KEYS.MIN_PEOPLE_PER_SESSION))
    writes.push([CONFIG_KEYS.MIN_PEOPLE_PER_SESSION, DEFAULT_MIN_PEOPLE]);
  if (!have.has(CONFIG_KEYS.ACTIVE_WEEKDAYS))
    writes.push([CONFIG_KEYS.ACTIVE_WEEKDAYS, DEFAULT_ACTIVE_WEEKDAYS]);
  if (!have.has(CONFIG_KEYS.VOTE_OPEN_DAY)) writes.push([CONFIG_KEYS.VOTE_OPEN_DAY, DEFAULT_VOTE_OPEN_DAY]);
  if (!have.has(CONFIG_KEYS.VOTE_CLOSE_DAY)) writes.push([CONFIG_KEYS.VOTE_CLOSE_DAY, DEFAULT_VOTE_CLOSE_DAY]);
  for (const [k, v] of writes) {
    await writeJson(d1, k, v);
  }
}

/** Helper bundle for vote-window lookups. */
export interface VoteWindowConfig {
  openDay: number;
  closeDay: number;
}

export async function getVoteWindowConfig(d1: D1Database): Promise<VoteWindowConfig> {
  const [openDay, closeDay] = await Promise.all([
    getNumber(d1, CONFIG_KEYS.VOTE_OPEN_DAY, DEFAULT_VOTE_OPEN_DAY),
    getNumber(d1, CONFIG_KEYS.VOTE_CLOSE_DAY, DEFAULT_VOTE_CLOSE_DAY),
  ]);
  return { openDay, closeDay };
}
