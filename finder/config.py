"""Configuration read from environment variables.

Inside a Databricks App these come from app.yaml (resource keys). Locally,
set them in your shell along with DATABRICKS_CONFIG_PROFILE.
"""
import os
import re

GENIE_SPACE_ID: str | None = os.getenv("GENIE_SPACE_ID")
WAREHOUSE_ID: str | None = os.getenv("DATABRICKS_WAREHOUSE_ID")
SCHEMA: str = os.getenv("VF_SCHEMA", "workspace.virtue_finder")

# SCHEMA is interpolated into SQL text (identifiers can't be parameters),
# so only allow plain catalog.schema identifiers.
if not re.fullmatch(r"[A-Za-z0-9_]+\.[A-Za-z0-9_]+", SCHEMA):
    raise ValueError(f"VF_SCHEMA must look like catalog.schema, got {SCHEMA!r}")


def missing() -> list[str]:
    """Names of required settings that are not set (for a friendly UI error)."""
    out = []
    if not WAREHOUSE_ID:
        out.append("DATABRICKS_WAREHOUSE_ID")
    if not GENIE_SPACE_ID:
        out.append("GENIE_SPACE_ID")
    return out
