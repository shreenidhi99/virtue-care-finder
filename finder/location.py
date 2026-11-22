"""Location resolution.

resolve("Kallidaikurichi" | "627416" | "8.68,77.47") -> list of Place candidates
via {SCHEMA}.resolve_location. Empty list = not found (the UI asks for a nearby
town / PIN). More than one = ambiguous (the UI asks the user to pick).
"""
from dataclasses import dataclass

import streamlit as st

from finder.config import SCHEMA
from finder.db import run_sql


@dataclass(frozen=True)
class Place:
    lat: float
    lon: float
    label: str
    confidence: str  # exact | high | medium | low


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def resolve(query: str) -> list[Place]:
    q = (query or "").strip()
    if not q:
        return []
    df = run_sql(f"SELECT * FROM {SCHEMA}.resolve_location(:q)", {"q": q})
    out = []
    for _, r in df.iterrows():
        try:
            out.append(Place(float(r["lat"]), float(r["lon"]), str(r["label"]), str(r["confidence"])))
        except (TypeError, ValueError):
            continue
    return out
