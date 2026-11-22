// runSql(statement, params) -> rows as objects. Named parameters only, never string formatting;
// the validated SCHEMA (config.ts) is the only thing interpolated into SQL text.
import "server-only";
import { api } from "./auth";
import { WAREHOUSE_ID } from "./config";

export type Row = Record<string, string | null>;

type StatementResponse = {
  statement_id: string;
  status: { state: string; error?: { message?: string } };
  manifest?: { schema: { columns: { name: string }[] } };
  result?: { data_array?: (string | null)[][]; next_chunk_internal_link?: string };
};

const DONE = new Set(["SUCCEEDED", "FAILED", "CANCELED", "CLOSED"]);

export async function runSql(statement: string, params: Record<string, string | number | null> = {}): Promise<Row[]> {
  let r = await api<StatementResponse>("/api/2.0/sql/statements", {
    method: "POST",
    body: {
      warehouse_id: WAREHOUSE_ID,
      statement,
      parameters: Object.entries(params).map(([name, v]) => ({ name, value: v === null ? null : String(v) })),
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE", // a cold Free Edition warehouse can take longer than 30 s
      disposition: "INLINE",
      format: "JSON_ARRAY",
    },
  });
  const deadline = Date.now() + 120_000;
  while (!DONE.has(r.status.state)) {
    if (Date.now() > deadline) throw new Error("The data warehouse took too long to answer.");
    await new Promise((ok) => setTimeout(ok, 1500));
    r = await api<StatementResponse>(`/api/2.0/sql/statements/${r.statement_id}`);
  }
  if (r.status.state !== "SUCCEEDED") {
    throw new Error(`SQL failed: ${r.status.state} ${r.status.error?.message ?? ""}`.trim());
  }
  const cols = r.manifest!.schema.columns.map((c) => c.name);
  const data = [...(r.result?.data_array ?? [])];
  let next = r.result?.next_chunk_internal_link;
  while (next) {
    const chunk = await api<{ data_array?: (string | null)[][]; next_chunk_internal_link?: string }>(next);
    data.push(...(chunk.data_array ?? []));
    next = chunk.next_chunk_internal_link;
  }
  return data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? null])));
}
