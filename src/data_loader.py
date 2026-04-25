"""Data access layer — reads mock SAP/HFM CSVs, applies RBAC filters.

All DataFrame returns are *already scoped* to what the user is allowed to see.
The agent/tools never touch raw dataframes directly; they call through here.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from .config import DATA_DIR
from .rbac import RBACContext


# --- raw loaders (cached on disk path) --------------------------------------
@lru_cache(maxsize=8)
def _read_csv(path_str: str) -> pd.DataFrame:
    return pd.read_csv(path_str)


def _actuals() -> pd.DataFrame:
    return _read_csv(str(DATA_DIR / "sap_gl_actuals.csv"))


def _budget() -> pd.DataFrame:
    return _read_csv(str(DATA_DIR / "sap_gl_budget.csv"))


def _hfm() -> pd.DataFrame:
    return _read_csv(str(DATA_DIR / "hfm_consolidated.csv"))


def _projects() -> pd.DataFrame:
    return _read_csv(str(DATA_DIR / "projects_roi.csv"))


# --- scoped loaders ---------------------------------------------------------
def actuals_for(ctx: RBACContext) -> pd.DataFrame:
    ctx.require("read_actuals")
    return ctx.filter_dataframe(_actuals())


def budget_for(ctx: RBACContext) -> pd.DataFrame:
    ctx.require("read_budget")
    return ctx.filter_dataframe(_budget())


def hfm_for(ctx: RBACContext) -> pd.DataFrame:
    # HFM has no region column → only BU scope applies
    ctx.require("read_actuals")
    df = _hfm()
    if ctx.bu_scope != "*":
        df = df[df["bu"] == ctx.bu_scope]
    return df.reset_index(drop=True)


def projects_for(ctx: RBACContext) -> pd.DataFrame:
    ctx.require("read_projects")
    return ctx.filter_dataframe(_projects())


# --- discovery helpers ------------------------------------------------------
def data_catalog(ctx: RBACContext) -> dict:
    """Summary of what this user can see — handy for the agent's system prompt."""
    a = actuals_for(ctx)
    p = projects_for(ctx)
    return {
        "actuals": {
            "rows": int(len(a)),
            "periods": sorted(a["period"].unique().tolist()) if len(a) else [],
            "business_units": sorted(a["bu"].unique().tolist()) if len(a) else [],
            "regions":  sorted(a["region"].unique().tolist()) if len(a) else [],
            "account_categories": sorted(a["account_category"].unique().tolist()) if len(a) else [],
        },
        "projects": {
            "rows": int(len(p)),
            "projects": sorted(p["project_name"].unique().tolist()) if len(p) else [],
        },
        "budget_access": ctx.can("read_budget"),
    }
