"""Databricks access: cached WorkspaceClient and run_sql() -> DataFrame.

Auth: inside a Databricks App, WorkspaceClient() uses the app's service
principal automatically; locally it uses the Databricks CLI profile.
All user values go through named parameters, never string formatting.
"""
import pandas as pd
import streamlit as st
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem, StatementState

from finder.config import WAREHOUSE_ID


@st.cache_resource
def client() -> WorkspaceClient:
    return WorkspaceClient()


def run_sql(statement: str, params: dict | None = None) -> pd.DataFrame:
    """Run a parameterised statement on the configured warehouse (waits up to 30 s).

    Values come back as strings; callers cast numeric columns.
    """
    if not WAREHOUSE_ID:
        raise RuntimeError("DATABRICKS_WAREHOUSE_ID is not set")
    p = [
        StatementParameterListItem(name=k, value=None if v is None else str(v))
        for k, v in (params or {}).items()
    ]
    r = client().statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        statement=statement,
        parameters=p,
        wait_timeout="30s",
    )
    if r.status.state != StatementState.SUCCEEDED:
        raise RuntimeError(f"SQL failed: {r.status.state} {r.status.error}")
    cols = [c.name for c in r.manifest.schema.columns]
    rows = (r.result.data_array if r.result else None) or []
    return pd.DataFrame(rows, columns=cols)
