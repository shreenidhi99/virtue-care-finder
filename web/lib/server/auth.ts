// Databricks auth for server routes. No secrets in code; three sources, in order:
//  1. DATABRICKS_HOST + DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET: a service principal
//     (auto-injected inside a Databricks App; set as host secrets on a public host).
//  2. The local Databricks CLI profile (DATABRICKS_CONFIG_PROFILE, default "care-finder"):
//     host from ~/.databrickscfg, token from `databricks auth token`.
import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLI_PROFILE } from "./config";

const run = promisify(execFile);

type Token = { value: string; expiresAt: number };
let cached: Token | null = null;
let pending: Promise<Token> | null = null;
let cliHost: string | null = null;

function normalizeHost(h: string): string {
  const s = h.trim().replace(/\/+$/, "");
  return s.startsWith("http") ? s : `https://${s}`;
}

async function profileHost(): Promise<string> {
  if (cliHost) return cliHost;
  const path = process.env.DATABRICKS_CONFIG_FILE ?? join(homedir(), ".databrickscfg");
  const text = await readFile(/*turbopackIgnore: true*/ path, "utf8");
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) section = sec[1].trim();
    else if (section === CLI_PROFILE) {
      const m = line.match(/^host\s*=\s*(.+)$/);
      if (m) return (cliHost = normalizeHost(m[1]));
    }
  }
  throw new Error(`No host for profile "${CLI_PROFILE}" in ${path}. Run: databricks auth login --profile ${CLI_PROFILE}`);
}

function usesServicePrincipal(): boolean {
  return Boolean(process.env.DATABRICKS_HOST && process.env.DATABRICKS_CLIENT_ID && process.env.DATABRICKS_CLIENT_SECRET);
}

export async function host(): Promise<string> {
  return usesServicePrincipal() ? normalizeHost(process.env.DATABRICKS_HOST!) : profileHost();
}

async function fetchToken(): Promise<Token> {
  if (usesServicePrincipal()) {
    // Trim: values pasted into a host's env-var UI often pick up a trailing space or newline.
    const id = process.env.DATABRICKS_CLIENT_ID!.trim();
    const secret = process.env.DATABRICKS_CLIENT_SECRET!.trim();
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const r = await fetch(`${await host()}/oidc/v1/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=all-apis",
      cache: "no-store",
    });
    if (!r.ok) {
      // Surface Databricks' reason (e.g. invalid_client) so a bad ID/secret is easy to spot; never echo the secret.
      let why = "";
      try {
        const e = (await r.json()) as { error?: string; error_description?: string };
        why = [e.error, e.error_description].filter(Boolean).join(": ");
      } catch {
        /* non-JSON body */
      }
      const hint = r.status === 401 ? " Check DATABRICKS_CLIENT_ID is the Application ID (a UUID) and the secret is current." : "";
      throw new Error(`Service principal sign-in failed (${r.status}${why ? `: ${why}` : ""}).${hint}`);
    }
    const j = (await r.json()) as { access_token: string; expires_in: number };
    return { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  }
  const { stdout } = await run("databricks", ["auth", "token", "--profile", CLI_PROFILE], { timeout: 30_000 });
  const j = JSON.parse(stdout) as { access_token: string; expiry?: string };
  const exp = j.expiry ? Date.parse(j.expiry) : Date.now() + 30 * 60 * 1000;
  return { value: j.access_token, expiresAt: exp };
}

export async function token(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;
  pending ??= fetchToken().finally(() => (pending = null));
  cached = await pending;
  return cached.value;
}

/** fetch() against the workspace REST API with auth; throws a short error on non-2xx. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${await host()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = (await r.json()) as { error_code?: string; message?: string };
      msg = [j.error_code, j.message].filter(Boolean).join(": ") || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}
