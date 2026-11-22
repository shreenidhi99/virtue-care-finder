import assert from "node:assert/strict";
import { test } from "node:test";
import { addContacts, confidence, idsNeedingContacts, pickPhone, quotes, shapeResult } from "../lib/results.ts";

const COLS = ["rank", "facility_name", "unique_id", "p", "distance_km", "city", "pincode", "best_receipts",
  "officialPhone", "address", "service_key", "backup_facility", "backup_km", "broadened"];
const ROW = ["1", "Govt. Tirunelveli Medical College Hospital", "abc-123", "0.97", "31.24", "Tirunelveli", "627011",
  JSON.stringify([{ quote: "24x7 emergency and anti-snake venom", src_col: "capability" }, { quote: "ICU", src_col: "equipment" }]),
  "+91 462 2572733, 0462 2572944", "High Ground Rd, null, Tirunelveli", "snakebite", "Lakshmi Hospital", "12", "false"];

test("facility rows become cards without internal fields", () => {
  const r = shapeResult(COLS, [ROW]);
  assert.equal(r?.kind, "facilities");
  if (r?.kind !== "facilities") return;
  const c = r.cards[0];
  assert.equal(c.name, "Govt. Tirunelveli Medical College Hospital");
  assert.equal(c.distance, "31.2 km");
  assert.equal(c.place, "Tirunelveli, 627011");
  assert.equal(c.confidence, 97);
  assert.equal(c.tel, "tel:+914622572733");
  assert.equal(c.phone, "+91 462 2572733");
  assert.equal(c.backup, "Lakshmi Hospital (12.0 km)");
  assert.deepEqual(c.quotes[0], { text: "24x7 emergency and anti-snake venom", source: "capability" });
  assert.match(c.directionsUrl, /High%20Ground%20Rd%2C%20Tirunelveli/);
  assert.equal(r.broadened, false);
  const json = JSON.stringify(r);
  for (const leaked of ["abc-123", "unique_id", "service_key", "best_receipts", "0.97"]) assert.ok(!json.includes(leaked), leaked);
});

test("broadened rows raise the honesty banner", () => {
  const row = [...ROW];
  row[COLS.indexOf("broadened")] = "true";
  const r = shapeResult(COLS, [row]);
  assert.ok(r?.kind === "facilities" && r.broadened && r.cards[0].broadened);
});

test("other table shapes drop internal columns", () => {
  const r = shapeResult(["district", "n", "unique_id", "p"], [["Tirunelveli", "29", "x", "0.5"]]);
  assert.deepEqual(r, { kind: "table", columns: ["district", "n"], rows: [["Tirunelveli", "29"]] });
});

test("quotes and confidence parsing", () => {
  assert.deepEqual(quotes("plain text"), [{ text: "plain text", source: null }]);
  assert.deepEqual(quotes('{"quote":"x","src_col":"specialties"}'), [{ text: "x", source: "specialty list" }]);
  assert.deepEqual(quotes("[]"), []);
  assert.equal(confidence({ p: "97" }), 97);
  assert.equal(confidence({ p: "0.655" }), 66);
  assert.equal(confidence({ p: null }), null);
});

test("cards follow rank order, one per facility", () => {
  const cols = ["rank", "facility_name", "entity_id", "best_receipts"];
  const r = shapeResult(cols, [["2", "Retteri Kumaran", "b", "[]"], ["1", "Meridian Hospital", "a", "[]"],
    ["10", "Eswar Medical", "c", "[]"], ["1", "Meridian Hospital", "a", "[]"]]);
  assert.ok(r?.kind === "facilities");
  if (r?.kind === "facilities") assert.deepEqual(r.cards.map((c) => c.name), ["Meridian Hospital", "Retteri Kumaran", "Eswar Medical"]);
});

test("Genie's own unranked query is not shown as recommendations", () => {
  // Shape Genie returned for "cancer care in kolathur" when it skipped the ranking function.
  const cols = ["unique_id", "name", "city", "evidence_text", "phone_number"];
  const r = shapeResult(cols, [["r", "Rajarajeswari Medical College", "Bengaluru", "Oncologic reconstruction", "1"],
    ["m", "Meridian Hospital", "Kolathur", "medicalOncology", "3"]]);
  assert.equal(r?.kind, "table");
  if (r?.kind === "table") {
    assert.match(r.note ?? "", /not ranked/);
    assert.ok(!r.columns.includes("unique_id"));
  }
});

test("rk_recommend rows get phone and address from the facility lookup", () => {
  // rk_recommend's real columns: no phone, no address.
  const cols = ["rank", "mode", "facility_name", "city", "pincode", "distance_km", "p", "best_receipts", "entity_id"];
  const rows = [["1", "recurring", "Meridian Hospital", "Chennai", "600099", "0.6", "0.99", "[]", "e46"],
                ["2", "recurring", "Unknown Clinic", "Chennai", "600099", "1.2", "0.8", "[]", "zzz"]];
  assert.deepEqual(idsNeedingContacts(cols, rows), ["e46", "zzz"]);
  const contacts = new Map([["e46", { phone: "+914466669910", address: "200feet Ring Road, Kolathur, null" }]]);
  const merged = addContacts(cols, rows, contacts);
  const r = shapeResult(merged.columns, merged.rows);
  assert.ok(r?.kind === "facilities");
  if (r?.kind !== "facilities") return;
  assert.equal(r.cards[0].phone, "+914466669910");
  assert.equal(r.cards[0].tel, "tel:+914466669910");
  assert.match(r.cards[0].directionsUrl, /Kolathur%2C%20Chennai/);
  assert.equal(r.cards[1].phone, null);
  assert.ok(!JSON.stringify(r).includes("e46"));
});

test("tables that already carry a phone, or aren't rankings, need no lookup", () => {
  assert.deepEqual(idsNeedingContacts(COLS, [ROW]), []);
  assert.deepEqual(idsNeedingContacts(["facility_name", "entity_id"], [["A", "x"]]), []);
});

test("pickPhone prefers officialPhone, else the first listed number", () => {
  assert.equal(pickPhone("+919677192226", '["+917338841190"]'), "+919677192226");
  assert.equal(pickPhone(null, '["+914466669910","+919035707740"]'), "+914466669910");
  assert.equal(pickPhone("null", "0462 2572944, 0462 1"), "0462 2572944");
  assert.equal(pickPhone(null, "[]"), null);
});
