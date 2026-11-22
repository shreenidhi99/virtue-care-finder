import { loadGeoQuality } from "@/lib/server/planner-data";
import { plannerJson } from "@/lib/server/route-helpers";

export const dynamic = "force-dynamic";
export const GET = () => plannerJson(loadGeoQuality);
