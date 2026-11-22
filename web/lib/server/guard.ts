// Protects the Free Edition compute quota from link traffic:
// - cached(): in-memory TTL cache for SQL results (concurrent identical calls share one query).
// - allow(): sliding-window rate limit per session (and one global bucket for Genie).
// - sessionId(): an anonymous random cookie, so limits apply per browser session.
import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { LIMITS } from "./config";

type Entry = { expires: number; value: Promise<unknown> };
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 1000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  value.catch(() => cache.delete(key)); // never cache failures (warehouse asleep, permissions)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

const hits = new Map<string, number[]>();

export function allow(bucket: string, limit: number, windowMs = LIMITS.windowMs): boolean {
  const now = Date.now();
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(bucket, recent);
    return false;
  }
  recent.push(now);
  hits.set(bucket, recent);
  return true;
}

export async function sessionId(): Promise<string> {
  const jar = await cookies();
  let id = jar.get("vf_sid")?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = randomUUID();
    jar.set("vf_sid", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  return id;
}

export const TOO_MANY = "Too many questions in a short time. Please wait a few minutes and try again.";
