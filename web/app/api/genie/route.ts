// POST {question, conversationId?} -> newline-delimited JSON stream of GenieEvent:
// progress events while Genie works, then one answer event.
import { LIMITS } from "@/lib/server/config";
import { ask } from "@/lib/server/genie";
import { allow, sessionId, TOO_MANY } from "@/lib/server/guard";
import type { GenieEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_CHARS = 1000;

export async function POST(req: Request) {
  let body: { question?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_CHARS) : "";
  const conversationId =
    typeof body.conversationId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(body.conversationId) ? body.conversationId : null;
  if (!question) return Response.json({ error: "Please type a question." }, { status: 400 });

  const sid = await sessionId();
  const ok = allow(`genie:${sid}`, LIMITS.geniePerSession) && allow("genie:all", LIMITS.genieGlobalPerHour, 3600_000);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (ev: GenieEvent) => ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      if (!ok) {
        send({ type: "answer", answer: { text: null, result: null, suggestions: [], conversationId, error: TOO_MANY } });
      } else {
        for await (const ev of ask(question, conversationId)) send(ev);
      }
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
