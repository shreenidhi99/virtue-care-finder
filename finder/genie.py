"""Genie Conversation API client.

ask(question, conversation_id) -> GenieAnswer(text, sql, df, conversation_id,
message_id, error). The question is sent exactly as the user typed it.
Never raises; failures come back in `error`.
"""
import datetime as dt
from dataclasses import dataclass, field

import pandas as pd

from finder.config import GENIE_SPACE_ID
from finder.db import client


@dataclass
class GenieAnswer:
    text: str | None
    sql: str | None
    df: pd.DataFrame | None
    conversation_id: str | None
    message_id: str | None
    error: str | None = None
    suggestions: list[str] = field(default_factory=list)  # Genie's suggested follow-ups / clarifying options


def ask(question: str, conversation_id: str | None = None) -> GenieAnswer:
    w = client()
    timeout = dt.timedelta(seconds=120)
    try:
        if conversation_id:
            msg = w.genie.create_message_and_wait(GENIE_SPACE_ID, conversation_id, question, timeout=timeout)
        else:
            msg = w.genie.start_conversation_and_wait(GENIE_SPACE_ID, question, timeout=timeout)
    except Exception as e:  # noqa: BLE001 - timeouts, FAILED/CANCELLED, permissions
        return GenieAnswer(None, None, None, conversation_id, None, error=str(e))

    if msg.error:
        return GenieAnswer(None, None, None, msg.conversation_id, msg.id, error=str(msg.error))

    texts: list[str] = []
    suggestions: list[str] = []
    sql = None
    df = None
    for a in msg.attachments or []:
        sq = getattr(a, "suggested_questions", None)
        if sq and sq.questions:
            suggestions += [q for q in sq.questions if q]
        if a.text and a.text.content:
            texts.append(a.text.content)
        if a.query:
            sql = a.query.query
            if a.query.description and not texts:
                texts.append(a.query.description)
            try:
                res = w.genie.get_message_attachment_query_result(
                    GENIE_SPACE_ID, msg.conversation_id, msg.id, a.attachment_id)
                sr = res.statement_response
                cols = [c.name for c in sr.manifest.schema.columns]
                rows = (sr.result.data_array if sr.result else None) or []
                df = pd.DataFrame(rows, columns=cols)
            except Exception:  # noqa: BLE001 - show the text even if rows can't be fetched
                df = None
    return GenieAnswer("\n\n".join(texts) or None, sql, df, msg.conversation_id, msg.id,
                       suggestions=list(dict.fromkeys(suggestions)))
