// Browser side of /api/genie: posts a question and reads the NDJSON stream of progress events.
import type { Answer, GenieEvent } from "./types";

export async function askGenie(
  question: string,
  conversationId: string | null,
  onProgress: (stage: string, thoughts: string[]) => void,
): Promise<Answer> {
  const fail = (error: string): Answer => ({ text: null, result: null, suggestions: [], conversationId, error });
  let res: Response;
  try {
    res = await fetch("/api/genie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, conversationId }),
    });
  } catch {
    return fail("Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    return fail((j as { error?: string }).error ?? `Server error (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as GenieEvent;
      if (ev.type === "progress") onProgress(ev.stage, ev.thoughts);
      else if (ev.type === "answer") return ev.answer;
    }
  }
  return fail("The answer was cut off. Please try again.");
}
