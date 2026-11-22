"""Result cards.

to_facilities(df) -> list[Facility]; render_banner() for the honesty banner;
render_card() with tier/trust badges, quoted evidence + source column, Call /
Directions / WhatsApp actions; why_dialog() with the score breakdown.
"""
from dataclasses import dataclass
from html import escape
from urllib.parse import quote

import pandas as pd
import streamlit as st

NUMERIC = ["rank", "latitude", "longitude", "distance_km",
           "s_match", "s_evidence", "s_distance", "s_size", "s_location", "score", "beds"]
BOOL = ["broadened", "rare"]

TIER_COLOR = {"Strong": "green", "Moderate": "orange", "Weak": "red"}
SOURCE_LABEL = {"capability": "capability", "procedure": "procedure", "description": "description",
                "equipment": "equipment", "specialties": "specialty list"}


@dataclass
class Facility:
    rank: int
    unique_id: str
    name: str
    facility_type: str
    operator: str
    phone: str | None
    latitude: float
    longitude: float
    distance_km: float
    tier: str
    best_quote: str
    quote_source: str
    matched_concept: str
    broadened: bool
    rare: bool
    location_confidence: str
    s_match: float
    s_evidence: float
    s_distance: float
    s_size: float
    s_location: float
    score: float
    beds: int | None = None


def _to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("true", "1", "t", "yes")


def to_facilities(df: pd.DataFrame | None) -> list[Facility]:
    """Cast the string columns returned by the Statement Execution API and build Facility objects."""
    if df is None or df.empty:
        return []
    d = df.copy()
    for c in NUMERIC:
        if c in d:
            d[c] = pd.to_numeric(d[c], errors="coerce")
    for c in BOOL:
        if c in d:
            d[c] = d[c].map(_to_bool)
    d = d.dropna(subset=["latitude", "longitude"]).sort_values("rank")
    out = []
    for r in d.to_dict("records"):
        phone = r.get("phone")
        out.append(Facility(
            rank=int(r["rank"]), unique_id=str(r["unique_id"]), name=str(r["name"]),
            facility_type=str(r.get("facility_type") or "Facility"),
            operator=str(r.get("operator") or ""),
            phone=None if phone in (None, "", "None") or pd.isna(phone) else str(phone),
            latitude=float(r["latitude"]), longitude=float(r["longitude"]),
            distance_km=float(r["distance_km"]), tier=str(r.get("tier") or "Weak"),
            best_quote=str(r.get("best_quote") or ""), quote_source=str(r.get("quote_source") or ""),
            matched_concept=str(r.get("matched_concept") or ""),
            broadened=bool(r.get("broadened", False)), rare=bool(r.get("rare", False)),
            location_confidence=str(r.get("location_confidence") or "low"),
            s_match=float(r.get("s_match") or 0), s_evidence=float(r.get("s_evidence") or 0),
            s_distance=float(r.get("s_distance") or 0), s_size=float(r.get("s_size") or 0),
            s_location=float(r.get("s_location") or 0), score=float(r.get("score") or 0),
            beds=None if pd.isna(r.get("beds")) else int(r["beds"]),
        ))
    return out


# ---------- links ----------

def tel_link(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    return f"tel:{digits}" if len(digits) >= 6 else None


def directions_link(f: Facility) -> str:
    return f"https://www.google.com/maps/dir/?api=1&destination={f.latitude:.6f},{f.longitude:.6f}"


def whatsapp_link(f: Facility) -> str:
    text = f"{f.name} ({f.distance_km:.1f} km)"
    if f.phone:
        text += f"\nPhone: {f.phone}"
    text += f"\nRecords mention: \"{f.best_quote[:200]}\"\nPlease verify by phone.\n{directions_link(f)}"
    return "https://wa.me/?text=" + quote(text)


# ---------- rendering ----------

def render_banner(facilities: list[Facility], service: str) -> None:
    if any(f.broadened for f in facilities):
        st.warning(f"**No facility nearby mentions “{service}”.** "
                   "Showing related / general emergency care instead. Call ahead before travelling.")
    if facilities and facilities[0].rare:
        st.info(f"“{service}” is rare in these records: few facilities in India mention it.")


def _badges(f: Facility) -> str:
    parts = [f":{TIER_COLOR.get(f.tier, 'gray')}-badge[{f.tier} evidence]"]
    if f.broadened:
        parts.append(":orange-badge[Broadened]")
    if f.rare:
        parts.append(":violet-badge[Rare service]")
    parts.append(":green-badge[Location verified]" if f.location_confidence == "high"
                 else ":gray-badge[Location uncertain]")
    parts.append(":blue-badge[Verify by phone]")
    return " ".join(parts)


def render_card(f: Facility, expanded: bool, on_why=None) -> None:
    with st.container(border=True):
        beds = f"{f.beds} beds" if f.beds else "beds not listed"
        st.markdown(f"**{f.rank}. {escape(f.name)}**  \n"
                    f"{f.distance_km:.1f} km · {beds} · {f.facility_type} · {f.operator}")
        st.markdown(_badges(f))
        if expanded:
            src = SOURCE_LABEL.get(f.quote_source, f.quote_source)
            st.markdown(f"> “{escape(f.best_quote[:300])}{'…' if len(f.best_quote) > 300 else ''}”  \n"
                        f"<small>Source: <code>{escape(src)}</code> · matched: {escape(f.matched_concept)}</small>",
                        unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        tl = tel_link(f.phone)
        if tl:
            c1.link_button("📞 Call", tl, type="primary" if expanded else "secondary", use_container_width=True)
        else:
            c1.button("📞 No phone", disabled=True, key=f"nophone-{f.unique_id}", use_container_width=True)
        c2.link_button("🧭 Directions", directions_link(f), use_container_width=True)
        c3.link_button("💬 Share", whatsapp_link(f), use_container_width=True)
        if c4.button("Why?", key=f"why-{f.unique_id}", use_container_width=True) and on_why:
            on_why(f)


COMPONENTS = [("Service match", "s_match"), ("Evidence strength", "s_evidence"),
              ("Distance", "s_distance"), ("Size / type", "s_size"), ("Location trust", "s_location")]


@st.dialog("Why this facility?", width="large")
def why_dialog(f: Facility, service: str, call_text: str) -> None:
    verdict = (f"Ranked **#{f.rank}** with score **{f.score:.3f}**: "
               f"{f.tier.lower()} evidence, {f.distance_km:.1f} km away.")
    st.markdown(verdict)
    st.markdown(f"> “{escape(f.best_quote)}”  \n<small>Source column: <code>{escape(f.quote_source)}</code> · "
                f"matched concept: {escape(f.matched_concept)}</small>", unsafe_allow_html=True)
    if f.broadened:
        st.warning(f"**Not found:** no record within the search radius mentions “{service}”. "
                   f"This facility is shown for related care ({f.matched_concept}).")
    st.markdown("**Score breakdown** (components add up to the total)")
    for label, attr in COMPONENTS:
        v = getattr(f, attr)
        c1, c2, c3 = st.columns([2, 5, 1])
        c1.write(label)
        c2.progress(min(1.0, v / 0.45) if v > 0 else 0.0)
        c3.write(f"{v:.3f}")
    st.markdown(f"**Total: {f.score:.3f}**")
    st.markdown(_badges(f))
    st.caption("Exact call used (deterministic: same inputs give the same order):")
    st.code(call_text, language="sql")
