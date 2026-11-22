// Copies the district boundaries built by ../scripts/build_district_geojson.py into public/,
// so the web app can be deployed from this folder alone. The copy is committed; this keeps it current.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "data", "india_districts.geojson");
const dst = join(here, "..", "public", "india_districts.geojson");

if (!existsSync(src)) {
  if (!existsSync(dst)) throw new Error(`Missing ${dst} and no source at ${src}`);
  process.exit(0); // deployed from web/ only: use the committed copy
}
if (!existsSync(dst) || !readFileSync(src).equals(readFileSync(dst))) {
  copyFileSync(src, dst);
  console.log("sync-data: updated public/india_districts.geojson");
}
