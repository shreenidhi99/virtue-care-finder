// Genie Conversation API client (port of finder/genie.py).
//
// The API does not stream tokens, so ask() polls the message about once a second and yields a
// progress event whenever Genie's stage or reasoning changes, then one answer event. It never
// throws: failures come back in answer.error. The question is sent exactly as the user typed it.
import "server-only";
import { addContacts, idsNeedingContacts, shapeResult } from "../results";
import { lookupContacts } from "./contacts";
import type { Answer, GenieEvent } from "../types";
import { api } from "./auth";
import { GENIE_SPACE_ID } from "./config";

type Thought = { content?: string; thought_type?: string };
type Attachment = {
  attachment_id?: string;
  text?: { content?: string };
  query?: { description?: string; query?: string; thoughts?: Thought[] };
  suggested_questions?: { questions?: string[] };
};
type Message = {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  status?: string;
  error?: { error?: string; type?: string } | string;
  attachments?: Attachment[];
};

export const STAGES: Record<string, string> = {
  SUBMITTED: "Sending your question…",
  FETCHING_METADATA: "Reading your question…",
  FILTERING_CONTEXT: "Finding the relevant facility records…",
  ASKING_AI: "Working out how to answer…",
  PENDING_WAREHOUSE: "Waiting for the data warehouse…",
  EXECUTING_QUERY: "Ranking facilities…",
};
const DONE = new Set(["COMPLETED", "FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"]);
// DATA_SOURCING (table names) and INSTRUCTIONS (space config) are internal; never shown.
const SHOWN = new Set(["THOUGHT_TYPE_DESCRIPTION", "THOUGHT_TYPE_UNDERSTANDING", "THOUGHT_TYPE_STEPS"]);
const TIMEOUT_MS = 120_000;

export function visibleThoughts(msg: Message): string[] {
  const out: string[] = [];
  for (const a of msg.attachments ?? []) {
    for (const t of a.query?.thoughts ?? []) {
      if (!t.content || !SHOWN.has(t.thought_type ?? "")) continue;
      const text = t.content
        .replace(/```[\s\S]*?```/g, "") // SQL / code blocks
        .replace(/`[^`]*\.[^`]*`/g, "") // `schema.table` references
        .trim();
      if (text) out.push(text);
    }
  }
  return out;
}

const base = `/api/2.0/genie/spaces/${GENIE_SPACE_ID}`;
const failed = (conversationId: string | null, error: string): Answer => ({
  text: null, result: null, suggestions: [], conversationId, error,
});

async function finish(msg: Message, conv: string, msgId: string): Promise<Answer> {
  const texts: string[] = [];
  const suggestions: string[] = [];
  let result: Answer["result"] = null;
  let emptySearch = false;
  for (const a of msg.attachments ?? []) {
    for (const q of a.suggested_questions?.questions ?? []) if (q) suggestions.push(q);
    if (a.text?.content) texts.push(a.text.content);
    if (a.query) {
      // The Genie UI shows the query's own description above its table; so do we (never the SQL).
      if (a.query.description) texts.push(a.query.description);
      try {
        const res = await api<{
          statement_response?: {
            manifest?: { schema?: { columns?: { name: string }[] } };
            result?: { data_array?: (string | null)[][] };
          };
        }>(`${base}/conversations/${conv}/messages/${msgId}/attachments/${a.attachment_id}/query-result`);
        const sr = res.statement_response;
        let cols = sr?.manifest?.schema?.columns?.map((c) => c.name) ?? [];
        let rows = sr?.result?.data_array ?? [];
        emptySearch = rows.length === 0;
        const ids = idsNeedingContacts(cols, rows);
        if (ids.length) {
          try {
            ({ columns: cols, rows } = addContacts(cols, rows, await lookupContacts(ids)));
          } catch {
            // cards still render, just without phone numbers
          }
        }
        result = shapeResult(cols, rows);
      } catch {
        result = null; // show the text even if rows can't be fetched
      }
    }
  }
  if (!texts.length && emptySearch) {
    // Genie ran a search that matched nothing and said nothing; don't leave the user with a blank answer.
    texts.push("No facility record within reach mentions this service. Records can be incomplete: call the nearest hospital to check.");
  }
  const answer: Answer = {
    text: [...new Set(texts)].join("\n\n") || null,
    result,
    suggestions: [...new Set(suggestions)],
    conversationId: conv,
    error: null,
  };
  if (emptySearch) emptySearches.add(answer);
  return answer;
}

// Answers whose facility search returned no rows (see ask(): they get one automatic, broader retry).
const emptySearches = new WeakSet<Answer>();

// Sent in the same conversation when a search comes back empty. Genie does not reliably apply the space's
// "fewer than 5 facilities -> category" rule, or notice that a place name gave no coordinates.
const BROADEN =
  "That search returned no rows. Widen it once and run it again: if the service is a concept with fewer than 5 " +
  "facilities in node_stats, look up that concept's category_key in v2_concept_lookup and call rk_recommend with svc_key = " +
  "the category_key (not the concept's node_key; for snake bite treatment that is 'emergencyandtrauma') and svc_level = " +
  "'category', keeping the same coordinates. If the location gave no " +
  "coordinates, resolve it again (a town can sit in a differently named district, e.g. Noida is in Gautam Buddha Nagar " +
  "district). Use radius_km 150. Say plainly that these are broader matches, not facilities whose records mention the exact service.";

/** One question -> progress events, then the answer. On an empty search, asks Genie once to widen it;
 *  the wider results are shown as "Broadened" cards under the yellow honesty banner. */
export async function* ask(question: string, conversationId: string | null): AsyncGenerator<GenieEvent> {
  let first: Answer | null = null;
  for await (const ev of askOnce(question, conversationId)) {
    if (ev.type === "answer") first = ev.answer;
    else yield ev;
  }
  if (!first || !emptySearches.has(first) || !first.conversationId) {
    if (first) yield { type: "answer", answer: first };
    return;
  }
  yield { type: "progress", stage: "No exact match nearby. Widening the search…", thoughts: [] };
  let wider: Answer | null = null;
  for await (const ev of askOnce(BROADEN, first.conversationId)) {
    if (ev.type === "answer") wider = ev.answer;
    else yield ev;
  }
  const r = wider?.result;
  if (!wider || wider.error || !r || (r.kind === "facilities" && !r.cards.length)) {
    yield { type: "answer", answer: { ...first, suggestions: wider?.suggestions.length ? wider.suggestions : first.suggestions } };
    return;
  }
  const result = r.kind === "facilities" ? { ...r, broadened: true, cards: r.cards.map((c) => ({ ...c, broadened: true })) } : r;
  yield { type: "answer", answer: { ...wider, result, text: wider.text } };
}

async function* askOnce(question: string, conversationId: string | null): AsyncGenerator<GenieEvent> {
  let conv: string;
  let msgId: string;
  try {
    if (conversationId) {
      const m = await api<Message>(`${base}/conversations/${conversationId}/messages`, {
        method: "POST", body: { content: question },
      });
      conv = conversationId;
      msgId = (m.message_id ?? m.id)!;
    } else {
      const r = await api<{ conversation_id: string; message_id: string }>(`${base}/start-conversation`, {
        method: "POST", body: { content: question },
      });
      conv = r.conversation_id;
      msgId = r.message_id;
    }
  } catch (e) {
    yield { type: "answer", answer: failed(conversationId, (e as Error).message) };
    return;
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let last = "";
  let lastSent = Date.now();
  let msg: Message;
  try {
    for (;;) {
      msg = await api<Message>(`${base}/conversations/${conv}/messages/${msgId}`);
      const status = msg.status ?? "SUBMITTED";
      if (DONE.has(status)) break;
      const ev = { type: "progress" as const, stage: STAGES[status] ?? "Working…", thoughts: visibleThoughts(msg) };
      const key = JSON.stringify(ev);
      if (key !== last) {
        yield ev;
        last = key;
        lastSent = Date.now();
      } else if (Date.now() - lastSent > 5000) {
        yield { type: "ping" }; // keeps the Databricks Apps proxy from timing out an idle stream
        lastSent = Date.now();
      }
      if (Date.now() > deadline) {
        yield { type: "answer", answer: failed(conv, "The assistant took too long. Please try again.") };
        return;
      }
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  } catch (e) {
    yield { type: "answer", answer: failed(conv, (e as Error).message) };
    return;
  }

  if (msg.error) {
    const err = typeof msg.error === "string" ? msg.error : msg.error.error ?? msg.error.type ?? "unknown error";
    yield { type: "answer", answer: failed(conv, err) };
    return;
  }
  if (msg.status !== "COMPLETED") {
    yield { type: "answer", answer: failed(conv, `The assistant stopped (${msg.status?.toLowerCase()}).`) };
    return;
  }
  yield { type: "answer", answer: await finish(msg, conv, msgId) };
}
