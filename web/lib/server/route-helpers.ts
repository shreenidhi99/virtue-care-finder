import "server-only";
import { LIMITS } from "./config";
import { allow, sessionId, TOO_MANY } from "./guard";

/** Runs a cached planner loader with a per-session limit; errors become a short JSON message. */
export async function plannerJson<T>(load: () => Promise<T>): Promise<Response> {
  if (!allow(`sql:${await sessionId()}`, LIMITS.sqlPerSession)) {
    return Response.json({ error: TOO_MANY }, { status: 429 });
  }
  try {
    return Response.json(await load(), { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
