// Phone and address for ranked facilities. The ranking function rk_recommend returns neither, so
// without this every card said "No phone listed" even when the facility record has a number.
import "server-only";
import { pickPhone, type Contact } from "../results";
import { SCHEMA } from "./config";
import { cached } from "./guard";
import { runSql } from "./sql";

const TTL = 6 * 60 * 60 * 1000;
const MAX_IDS = 50;

export async function lookupContacts(ids: string[]): Promise<Map<string, Contact>> {
  const want = [...new Set(ids)].slice(0, MAX_IDS).sort();
  if (!want.length) return new Map();
  const rows = await cached(`contacts|${want.join(",")}`, TTL, () =>
    runSql(
      `SELECT unique_id, officialPhone, phone_numbers, address FROM ${SCHEMA}.facility_profile ` +
        `WHERE array_contains(from_json(:ids, 'array<string>'), unique_id)`,
      { ids: JSON.stringify(want) },
    ),
  );
  const out = new Map<string, Contact>();
  for (const r of rows) {
    const id = r.unique_id;
    if (!id) continue;
    const prev = out.get(id);
    const c = { phone: pickPhone(r.officialPhone, r.phone_numbers), address: r.address };
    // A facility can appear more than once; keep the first row that has a phone.
    if (!prev || (!prev.phone && c.phone)) out.set(id, c);
  }
  return out;
}
