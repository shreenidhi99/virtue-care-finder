"""Readable result cards for the agent's facility tables.

The agent returns ~20 columns, many of them internal (ids, keys, model
fields) and one JSON blob of evidence (best_receipts). Users see only what helps
them act: name, distance, a confidence badge, the evidence quotes with their source
column, a backup option, and Call / Directions. Any other table shape (counts,
lists) is shown as a plain table without internal id/key columns.
"""
import json
from html import escape
from urllib.parse import quote

import pandas as pd
import streamlit as st

NAME_COLS = ("facility_name", "name", "facility")
CONFIDENCE_COLS = ("p", "confidence", "score")
EMPTY = {"", "none", "null", "nan", "[]", "{}"}
INTERNAL = ("entity_id", "unique_id", "service_key", "service_level", "facility_profile_name",
            "mode", "p", "expected_km", "best_receipts", "rarity_class",
            "value_status", "unit")  # last two: NFHS-5 survey bookkeeping, not shown to users
SOURCE_LABEL = {"capability": "capability", "procedure": "procedure", "description": "description",
                "equipment": "equipment", "specialties": "specialty list"}


def _v(row: pd.Series, col: str) -> str | None:
    """Cell as clean text, or None when missing/empty."""
    if col not in row.index:
        return None
    val = row[col]
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    return None if s.lower() in EMPTY else s


def name_column(df: pd.DataFrame | None) -> str | None:
    if df is None or df.empty:
        return None
    return next((c for c in NAME_COLS if c in df.columns), None)


def _km(s: str | None) -> str | None:
    try:
        return f"{float(s):.1f} km"
    except (TypeError, ValueError):
        return None


def _tel(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in phone.split(",")[0] if ch.isdigit() or ch == "+")
    return f"tel:{digits}" if len(digits) >= 6 else None


def _clean_address(addr: str | None) -> str | None:
    if not addr:
        return None
    parts = [p.strip() for p in addr.split(",") if p.strip() and p.strip().lower() not in EMPTY]
    return ", ".join(parts) or None


def quotes(raw: str | None) -> list[tuple[str, str]]:
    """best_receipts JSON -> [(quote, source column)]; plain text is kept as one quote."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return [(raw, "")]
    if isinstance(data, dict):
        data = [data]
    out = []
    for item in data if isinstance(data, list) else []:
        if isinstance(item, dict) and str(item.get("quote") or "").strip():
            out.append((str(item["quote"]).strip(), str(item.get("src_col") or "").strip()))
        elif isinstance(item, str) and item.strip():
            out.append((item.strip(), ""))
    return out


def confidence(row: pd.Series) -> int | None:
    """Confidence as a whole percent (0.97 -> 97; 97 stays 97)."""
    for col in CONFIDENCE_COLS:
        try:
            v = float(_v(row, col))
        except (TypeError, ValueError):
            continue
        return round(v * 100 if v <= 1 else v)
    return None


def confidence_badge(pct: int) -> str:
    color = "green" if pct > 80 else "orange" if pct >= 60 else "red"
    return f":{color}-badge[Confidence {pct}%]"


def render_card(row: pd.Series, name_col: str, expanded: bool, key: str) -> None:
    name = _v(row, name_col) or "Facility"
    rank = _v(row, "rank")
    place = ", ".join(p for p in (_v(row, "city"), _v(row, "pincode")) if p)
    head = " · ".join(p for p in (_km(_v(row, "distance_km")), place) if p)

    with st.container(border=True):
        st.markdown(f"**{rank + '. ' if rank else ''}{escape(name)}**  \n{escape(head)}")
        badges = []
        pct = confidence(row)
        if pct is not None:
            badges.append(confidence_badge(pct))
        badges.append(":blue-badge[Verify by phone]")
        st.markdown(" ".join(badges))

        qs = quotes(_v(row, "best_receipts"))
        for text, src in qs[: 3 if expanded else 1]:
            src_txt = f"Source: <code>{escape(SOURCE_LABEL.get(src, src))}</code>" if src else "From the records"
            st.markdown(f"> “{escape(text)}”  \n<small>{src_txt}</small>", unsafe_allow_html=True)

        if expanded:
            for label, col in (("Why not a closer one", "why_not_closer"), ("Location", "location_note")):
                txt = _v(row, col)
                if txt:
                    st.markdown(f"**{label}:** {escape(txt)}")
            backup = _v(row, "backup_facility")
            if backup:
                bk = _km(_v(row, "backup_km"))
                st.markdown(f"**Backup:** {escape(backup)}{f' ({bk})' if bk else ''}")

        phone = _v(row, "officialPhone") or _v(row, "phone")
        addr = _clean_address(_v(row, "address"))
        c1, c2 = st.columns(2)
        tl = _tel(phone)
        if tl:
            c1.link_button(f"📞 {phone.split(',')[0]}", tl, width="stretch",
                           type="primary" if expanded else "secondary")
        else:
            c1.button("📞 No phone listed", disabled=True, width="stretch", key=f"np-{key}")
        q = quote(", ".join(p for p in (name, addr, place) if p))
        c2.link_button("🧭 Directions", f"https://www.google.com/maps/search/?api=1&query={q}", width="stretch")


def render_table(df: pd.DataFrame | None, key: str) -> None:
    """Cards for facility results (first one expanded); plain table for anything else."""
    if df is None or df.empty:
        return
    col = name_column(df)
    if col is None:
        # Case-insensitive: Genie sometimes aliases columns (e.g. "Value_Status", "UNIT").
        hidden = [c for c in df.columns if str(c).strip().lower() in INTERNAL]
        st.dataframe(df.drop(columns=hidden), width="stretch", hide_index=True)
        return
    for i, (_, row) in enumerate(df.iterrows()):
        render_card(row, col, expanded=(i == 0), key=f"{key}-{i}")
