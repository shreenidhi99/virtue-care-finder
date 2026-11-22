// Settings read from environment variables (server only).
//
// In a Databricks App they come from app.yaml (resource keys). Locally, `npm run dev`
// uses the team defaults below, and auth comes from the Databricks CLI profile.
// None of these are secrets.

export const GENIE_SPACE_ID = process.env.GENIE_SPACE_ID ?? "01f1e5d2ef9711989854a6d1fb63067c";
export const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID ?? "0d88dd62ca1e1fec";
export const SCHEMA = process.env.VF_SCHEMA ?? "workspace.virtue_finder";
export const CLI_PROFILE = process.env.DATABRICKS_CONFIG_PROFILE ?? "care-finder";

// SCHEMA is interpolated into SQL text (identifiers can't be parameters),
// so only allow plain catalog.schema identifiers.
if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(SCHEMA)) {
  throw new Error(`VF_SCHEMA must look like catalog.schema, got ${JSON.stringify(SCHEMA)}`);
}

function intEnv(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Public-link protection for the Free Edition compute quota.
export const LIMITS = {
  geniePerSession: intEnv("VF_GENIE_PER_SESSION", 20), // questions per session per window
  genieGlobalPerHour: intEnv("VF_GENIE_PER_HOUR", 300), // all sessions together
  sqlPerSession: intEnv("VF_SQL_PER_SESSION", 120), // uncached planner queries per session per window
  windowMs: 10 * 60 * 1000,
};
