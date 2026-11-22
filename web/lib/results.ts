// The agent's result table -> what users see (port of finder/results.py).
//
// The agent returns ~20 columns, many internal (ids, keys, model fields) plus one JSON blob of
// evidence (best_receipts). Facility tables become cards: name, distance, a confidence badge, the
// evidence quotes with their source column, a backup option, Call / Directions. Any other table
// shape (counts, lists) is passed on as a plain table without the internal columns.
import type { AnswerResult, FacilityCard, Quote } from "./types";

type Row = Record<string, string | null>;

const NAME_COLS = ["facility_name", "name", "facility"];
const CONFIDENCE_COLS = ["p", "confidence", "score"];
const EMPTY = new Set(["", "none", "null", "nan", "[]", "{}"]);
export const INTERNAL = new Set([
  "entity_id", "unique_id", "service_key", "service_level", "facility_profile_name",
  "mode", "p", "expected_km", "best_receipts", "rarity_class", "broadened",
  // NFHS-5 answers: survey bookkeeping, not something users act on.
  "value_status", "unit",
]);
const SOURCE_LABEL: Record<string, string> = {
  capability: "capability", procedure: "procedure", description: "description",
  equipment: "equipment", specialties: "specialty list",
};

function v(row: Row, col: string): string | null {
  const s = row[col];
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return EMPTY.has(t.toLowerCase()) ? null : t;
}

function km(s: string | null): string | null {
  const n = s === null ? NaN : Number(s);
  return Number.isFinite(n) ? `${n.toFixed(1)} km` : null;
}

function tel(phone: string | null): string | null {
  if (!phone) return null;
  const digits = [...phone.split(",")[0]].filter((ch) => /[0-9+]/.test(ch)).join("");
  return digits.length >= 6 ? `tel:${digits}` : null;
}

function cleanAddress(addr: string | null): string | null {
  if (!addr) return null;
  const parts = addr.split(",").map((p) => p.trim()).filter((p) => p && !EMPTY.has(p.toLowerCase()));
  return parts.join(", ") || null;
}

/** best_receipts JSON -> quotes with their source column; plain text is kept as one quote. */
export function quotes(raw: string | null): Quote[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [{ text: raw, source: null }];
  }
  if (data && typeof data === "object" && !Array.isArray(data)) data = [data];
  if (!Array.isArray(data)) return [];
  const out: Quote[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const q = String((item as Record<string, unknown>).quote ?? "").trim();
      const src = String((item as Record<string, unknown>).src_col ?? "").trim();
      if (q) out.push({ text: q, source: src ? SOURCE_LABEL[src] ?? src : null });
    } else if (typeof item === "string" && item.trim()) {
      out.push({ text: item.trim(), source: null });
    }
  }
  return out;
}

/** Confidence as a whole percent (0.97 -> 97; 97 stays 97). */
export function confidence(row: Row): number | null {
  for (const col of CONFIDENCE_COLS) {
    const s = v(row, col);
    const n = s === null ? NaN : Number(s);
    if (Number.isFinite(n)) return Math.round(n <= 1 ? n * 100 : n);
  }
  return null;
}

function card(row: Row, nameCol: string): FacilityCard {
  const name = v(row, nameCol) ?? "Facility";
  const place = [v(row, "city"), v(row, "pincode")].filter(Boolean).join(", ") || null;
  const phone = v(row, "officialPhone") ?? v(row, "phone");
  const addr = cleanAddress(v(row, "address"));
  const backupName = v(row, "backup_facility");
  const backupKm = km(v(row, "backup_km"));
  const q = encodeURIComponent([name, addr, place].filter(Boolean).join(", "));
  return {
    rank: v(row, "rank"),
    name,
    distance: km(v(row, "distance_km")),
    place,
    confidence: confidence(row),
    broadened: (v(row, "broadened") ?? "").toLowerCase() === "true",
    quotes: quotes(v(row, "best_receipts")),
    whyNotCloser: v(row, "why_not_closer"),
    locationNote: v(row, "location_note"),
    backup: backupName ? `${backupName}${backupKm ? ` (${backupKm})` : ""}` : null,
    phone: phone ? phone.split(",")[0].trim() : null,
    tel: tel(phone),
    directionsUrl: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

const ID_COLS = ["entity_id", "unique_id"];
export const UNRANKED_NOTE =
  "These facilities were not ranked by distance, so they are not shown as recommendations. For a ranked list, ask again " +
  "with a PIN code or a more specific place (for example “cancer care near PIN 600099” or “cancer care in Kolathur, Chennai”).";

/** Rows of the ranking function's table, sorted by rank, one per facility; null for any other shape (port of results.ranked).
 *  Genie sometimes writes its own query instead of calling the ranking function. Such tables have no rank and can repeat a
 *  facility once per quote or phone number, so their row order is not a recommendation and they must not become cards. */
export function ranked(rows: Row[], nameCol: string): Row[] | null {
  if (!rows.length || !("rank" in rows[0])) return null;
  const withRank = rows
    .map((r, i) => ({ r, i, rank: r.rank === null || r.rank.trim() === "" ? NaN : Number(r.rank) }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => a.rank - b.rank || a.i - b.i); // stable
  if (!withRank.length) return null;
  const ident = ID_COLS.find((c) => c in rows[0]) ?? nameCol;
  const seen = new Set<string | null>();
  return withRank.map((x) => x.r).filter((r) => !seen.has(r[ident]) && (seen.add(r[ident]), true));
}

export type Contact = { phone: string | null; address: string | null };

/** officialPhone, else the first number in phone_numbers (stored as a JSON array, sometimes a comma list). */
export function pickPhone(official: string | null, numbers: string | null): string | null {
  const o = official?.trim();
  if (o && !EMPTY.has(o.toLowerCase())) return o;
  const n = numbers?.trim();
  if (!n || EMPTY.has(n.toLowerCase())) return null;
  let list: unknown;
  try {
    list = JSON.parse(n);
  } catch {
    list = n.split(",");
  }
  const first = (Array.isArray(list) ? list : [list]).map((x) => String(x ?? "").trim()).find((x) => x && !EMPTY.has(x.toLowerCase()));
  return first ?? null;
}

/** Ids of a ranking table whose rows lack contact details (rk_recommend returns no phone or address). */
export function idsNeedingContacts(columns: string[], rows: (string | null)[][]): string[] {
  const idCol = ID_COLS.map((c) => columns.indexOf(c)).find((i) => i >= 0);
  if (idCol === undefined || !columns.includes("rank") || columns.includes("officialPhone") || columns.includes("phone")) return [];
  return [...new Set(rows.map((r) => r[idCol]).filter((x): x is string => !!x))];
}

/** Adds phone (and address, when missing) columns from the facility lookup, matched by id. */
export function addContacts(columns: string[], rows: (string | null)[][], contacts: Map<string, Contact>) {
  const idCol = ID_COLS.map((c) => columns.indexOf(c)).find((i) => i >= 0);
  if (idCol === undefined || !contacts.size) return { columns, rows };
  const needAddress = !columns.includes("address");
  return {
    columns: [...columns, "phone", ...(needAddress ? ["address"] : [])],
    rows: rows.map((r) => {
      const c = contacts.get(r[idCol] ?? "");
      return [...r, c?.phone ?? null, ...(needAddress ? [c?.address ?? null] : [])];
    }),
  };
}

function plainTable(columns: string[], rows: (string | null)[][], note?: string): AnswerResult {
  // Case-insensitive: Genie sometimes aliases columns (e.g. "Value_Status", "UNIT").
  const keep = columns.map((c, i) => [c, i] as const).filter(([c]) => !INTERNAL.has(c.trim().toLowerCase()));
  return { kind: "table", columns: keep.map(([c]) => c), rows: rows.map((r) => keep.map(([, i]) => r[i])), ...(note ? { note } : {}) };
}

export function shapeResult(columns: string[], rows: (string | null)[][]): AnswerResult | null {
  if (!rows.length) return null;
  const nameCol = NAME_COLS.find((c) => columns.includes(c));
  if (!nameCol) return plainTable(columns, rows);
  const objs = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null])) as Row);
  const r = ranked(objs, nameCol);
  if (!r) return plainTable(columns, rows, UNRANKED_NOTE);
  const cards = r.map((row) => card(row, nameCol));
  return { kind: "facilities", cards, broadened: cards.some((c) => c.broadened) };
}
