"use client";
// One agent answer: Genie's own text (markdown, as the Genie app shows it), then the result.
// Facility results are cards inside their own scrollable box, never raw tables.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Answer, AnswerResult, FacilityCard } from "@/lib/types";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ConfidenceBadge({ pct }: { pct: number }) {
  const tone = pct > 80 ? "green" : pct >= 60 ? "orange" : "red";
  return <span className={`badge ${tone}`}>Confidence {pct}%</span>;
}

export function Card({ c, expanded }: { c: FacilityCard; expanded: boolean }) {
  const head = [c.distance, c.place].filter(Boolean).join(" · ");
  return (
    <article className={`card${expanded ? " expanded" : ""}`}>
      <h4>
        {c.rank ? `${c.rank}. ` : ""}
        {c.name}
      </h4>
      {head && <div className="muted">{head}</div>}
      <div className="badges">
        {c.confidence !== null && <ConfidenceBadge pct={c.confidence} />}
        {c.broadened && <span className="badge yellow">Broadened</span>}
        <span className="badge blue">Verify by phone</span>
      </div>
      {c.quotes.slice(0, expanded ? 3 : 1).map((q, i) => (
        <blockquote key={i}>
          “{q.text}”
          <small>{q.source ? <>Source: <code>{q.source}</code></> : "From the records"}</small>
        </blockquote>
      ))}
      {expanded && (
        <>
          {c.whyNotCloser && <p><b>Why not a closer one:</b> {c.whyNotCloser}</p>}
          {c.locationNote && <p><b>Location:</b> {c.locationNote}</p>}
          {c.backup && <p><b>Backup:</b> {c.backup}</p>}
        </>
      )}
      <div className="actions">
        {c.tel ? (
          <a className={`btn${expanded ? " primary" : ""}`} href={c.tel}>📞 {c.phone}</a>
        ) : (
          <span className="btn disabled">📞 No phone listed</span>
        )}
        <a className="btn" href={c.directionsUrl} target="_blank" rel="noreferrer">🧭 Directions</a>
      </div>
    </article>
  );
}

function Result({ r }: { r: AnswerResult }) {
  if (r.kind === "table") {
    return (
      <>
      {r.note && <div className="banner blue">{r.note}</div>}
      <div className="scrollbox table-box">
        <table>
          <thead><tr>{r.columns.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={j}>{v ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
    );
  }
  return (
    <section className="results">
      {r.broadened && (
        <div className="banner yellow">
          No facility record mentions this exact service, so these are broader matches. Call before travelling.
        </div>
      )}
      <div className="results-head">
        {r.cards.length} {r.cards.length === 1 ? "facility" : "facilities"}
        {r.cards.length > 1 && <span className="muted"> · scroll inside the box for more</span>}
      </div>
      <div className="scrollbox cards-box">
        {r.cards.map((c, i) => <Card key={i} c={c} expanded={i === 0} />)}
      </div>
    </section>
  );
}

export function AnswerView({ a }: { a: Answer }) {
  return (
    <>
      {a.error && <div className="banner red">The assistant couldn&apos;t answer: {a.error}</div>}
      {a.text && <Markdown text={a.text} />}
      {a.result && <Result r={a.result} />}
      {!a.error && !a.text && !a.result && <p className="muted">The assistant returned no answer.</p>}
    </>
  );
}

/** Live progress while Genie works; afterwards a collapsed "how it got there" box. */
export function Thinking({ stage, thoughts, done, failed }: { stage: string; thoughts: string[]; done: boolean; failed?: boolean }) {
  if (!done) {
    return (
      <div className="thinking live" aria-live="polite">
        <div className="stage"><span className="spinner" /> {stage}</div>
        {thoughts.length > 0 && <div className="thoughts">{thoughts.map((t, i) => <Markdown key={i} text={t} />)}</div>}
      </div>
    );
  }
  if (!thoughts.length) return null;
  return (
    <details className="thinking">
      <summary>{failed ? "What the assistant tried" : "How the assistant worked it out"}</summary>
      <div className="thoughts">{thoughts.map((t, i) => <Markdown key={i} text={t} />)}</div>
    </details>
  );
}
