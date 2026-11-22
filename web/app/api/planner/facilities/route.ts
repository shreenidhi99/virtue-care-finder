import { loadDistricts, loadFacilities } from "@/lib/server/planner-data";
import { plannerJson } from "@/lib/server/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const state = u.searchParams.get("state") ?? "";
  const district = u.searchParams.get("district") ?? "";
  return plannerJson(async () => {
    // Only real NFHS-5 districts: keeps the cache from filling with junk keys.
    const known = (await loadDistricts()).some((d) => d.state === state && d.district === district);
    if (!known) throw new Error("Unknown district");
    return loadFacilities(state, district);
  });
}
