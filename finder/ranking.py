"""Direct, deterministic ranking path.

recommend(service, lat, lon, urgent, radius_km, top_n) -> DataFrame by calling
the SQL table function {SCHEMA}.recommend_facilities with named parameters.
Also the fallback when Genie is slow or returns a different shape.
"""
import pandas as pd
import streamlit as st

from finder.config import SCHEMA
from finder.db import run_sql

RESULT_COLUMNS = [
    "rank", "unique_id", "name", "facility_type", "operator", "phone", "latitude", "longitude",
    "distance_km", "tier", "best_quote", "quote_source", "matched_concept", "broadened", "rare",
    "location_confidence", "s_match", "s_evidence", "s_distance", "s_size", "s_location", "score",
    "beds",
]


def is_ranking_result(df: pd.DataFrame | None) -> bool:
    """True when a DataFrame (e.g. from Genie) has the recommend_facilities shape."""
    return df is not None and {"rank", "score", "best_quote", "unique_id"}.issubset(df.columns)


@st.cache_data(ttl=3600, show_spinner=False)
def recommend(service: str, lat: float, lon: float, urgent: bool = False,
              radius_km: float = 60, top_n: int = 10, min_beds: int = 0) -> pd.DataFrame:
    # SCHEMA comes from validated config, never from user input; user values are parameters.
    return run_sql(
        f"SELECT * FROM {SCHEMA}.recommend_facilities("
        ":service, CAST(:lat AS DOUBLE), CAST(:lon AS DOUBLE), "
        "CAST(:urgent AS BOOLEAN), CAST(:radius AS DOUBLE), CAST(:top_n AS INT), "
        "CAST(:min_beds AS DOUBLE))",
        {"service": service.strip(), "lat": round(float(lat), 5), "lon": round(float(lon), 5),
         "urgent": str(bool(urgent)).lower(), "radius": float(radius_km), "top_n": int(top_n),
         "min_beds": int(min_beds)},
    )


def function_call_text(service: str, lat: float, lon: float, urgent: bool,
                       radius_km: float = 60, top_n: int = 10, min_beds: int = 0) -> str:
    """Human-readable call shown in the 'Why' panel (display only, never executed)."""
    svc = service.replace("'", "''")
    return (f"SELECT * FROM {SCHEMA}.recommend_facilities('{svc}', {lat:.4f}, {lon:.4f}, "
            f"{str(urgent).lower()}, {radius_km:g}, {top_n}, {min_beds})")
