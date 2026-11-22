"use client";
// A conversation with the Genie agent, shared by Find care and the planner's "Ask about an area".
//
// - Follow-ups, suggested replies and "Why this facility?" continue the same Genie conversation.
// - Scrolling: when a question is sent, it is scrolled to the top of the screen and left there,
//   so the answer is read from its first line. Nothing jumps to the bottom when the answer lands.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { askGenie } from "@/lib/genie-client";
import type { Answer } from "@/lib/types";
import { AnswerView, Thinking } from "./Answer";

const WHY_QUESTION = (name: string) =>
  `WHY this facility? What evidence says this facility exists, offers this service, and is the best choice for this location?\nFacility: ${name}`;

type Live = { stage: string; thoughts: string[]; answer: Answer | null };
type Why = Live & { id: string; name: string };
type Turn = Live & { id: string; question: string; chip?: string; why: Why[] };

let seq = 0;
const newId = () => `t${++seq}`;

export default function Chat({
  examples = [], placeholder, wrap, chip, disabledReason, resetKey, sticky = false, intro,
}: {
  examples?: string[];
  placeholder: string;
  wrap?: (q: string) => string; // applied to the first message of a conversation (e.g. add the pin)
  chip?: string; // small label on the user's message (e.g. the pinned district)
  disabledReason?: string | null;
  resetKey?: string;
  sticky?: boolean;
  intro?: ReactNode;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const conv = useRef<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    setTurns([]);
    conv.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (!scrollTo) return;
    els.current.get(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTo(null);
  }, [scrollTo]);

  const patchTurn = (id: string, p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const patchWhy = (tid: string, wid: string, p: Partial<Why>) =>
    setTurns((ts) => ts.map((t) => (t.id === tid ? { ...t, why: t.why.map((w) => (w.id === wid ? { ...w, ...p } : w)) } : t)));

  async function run(message: string, onProgress: (stage: string, thoughts: string[]) => void): Promise<Answer> {
    setBusy(true);
    try {
      const a = await askGenie(message, conv.current, onProgress);
      if (a.conversationId) conv.current = a.conversationId;
      return a;
    } finally {
      setBusy(false);
    }
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy || disabledReason) return;
    const id = newId();
    const message = !conv.current && wrap ? wrap(q) : q;
    setTurns((ts) => [...ts, { id, question: q, chip, stage: "Sending your question…", thoughts: [], answer: null, why: [] }]);
    setText("");
    setScrollTo(id);
    const answer = await run(message, (stage, thoughts) =>
      patchTurn(id, thoughts.length ? { stage, thoughts } : { stage }), // keep thoughts when Genie starts its next step
    );
    patchTurn(id, { answer });
  }

  async function askWhy(turn: Turn, name: string) {
    if (busy || !name) return;
    const wid = newId();
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, why: [...t.why, { id: wid, name, stage: `Asking why ${name}…`, thoughts: [], answer: null }] } : t)));
    setScrollTo(wid);
    const answer = await run(WHY_QUESTION(name), (stage, thoughts) => patchWhy(turn.id, wid, thoughts.length ? { stage, thoughts } : { stage }));
    patchWhy(turn.id, wid, { answer });
  }

  function reset() {
    setTurns([]);
    conv.current = null;
  }

  const last = turns[turns.length - 1];
  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };

  return (
    <div className={`chat${sticky ? " full" : ""}`}>
      <div className="chat-top">
        <div className="muted">{intro}</div>
        {turns.length > 0 && <button className="btn" onClick={reset} disabled={busy}>New chat</button>}
      </div>

      {turns.length === 0 && examples.length > 0 && (
        <div className="examples">
          <b>Try:</b>
          {examples.map((ex) => (
            <button key={ex} className="btn ghost" disabled={busy || !!disabledReason} onClick={() => send(ex)}>{ex}</button>
          ))}
        </div>
      )}

      {turns.map((t) => (
        <div key={t.id} className="turn">
          <div className="msg user" ref={ref(t.id)}>
            <span className="who">You</span>
            <div>{t.question}{t.chip && <span className="chip">📍 {t.chip}</span>}</div>
          </div>
          <div className="msg bot">
            <span className="who">Assistant</span>
            <Thinking stage={t.stage} thoughts={t.thoughts} done={!!t.answer} failed={!!t.answer?.error} />
            {t.answer && <AnswerView a={t.answer} />}
            {t.answer?.result?.kind === "facilities" && t.answer.result.cards.length > 0 && (
              <WhyPicker names={t.answer.result.cards.map((c) => c.name)} busy={busy} onAsk={(n) => askWhy(t, n)} />
            )}
            {t.why.map((w) => (
              <div key={w.id} className="why" ref={ref(w.id)}>
                <h4>Why {w.name}?</h4>
                <Thinking stage={w.stage} thoughts={w.thoughts} done={!!w.answer} failed={!!w.answer?.error} />
                {w.answer && <AnswerView a={w.answer} />}
              </div>
            ))}
            {t === last && t.answer && t.answer.suggestions.length > 0 && (
              <div className="suggestions">
                <span className="muted">Reply, or tap one:</span>
                {t.answer.suggestions.map((s) => (
                  <button key={s} className="btn ghost" disabled={busy} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      <form
        className={`ask${sticky ? " sticky" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabledReason ?? placeholder}
          disabled={busy || !!disabledReason}
          maxLength={1000}
          aria-label={placeholder}
        />
        <button className="btn primary" disabled={busy || !!disabledReason || !text.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
    </div>
  );
}

function WhyPicker({ names, busy, onAsk }: { names: string[]; busy: boolean; onAsk: (name: string) => void }) {
  const unique = [...new Set(names)];
  const [pick, setPick] = useState(unique[0]);
  return (
    <div className="why-picker">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Facility">
        {unique.map((n) => <option key={n}>{n}</option>)}
      </select>
      <button className="btn" disabled={busy} onClick={() => onAsk(pick)}>Why this facility?</button>
    </div>
  );
}
