"""Agent tools — deterministic finance computations the LLM can call.

Each tool:
  1. Takes an `RBACContext` implicitly (bound into the dispatcher, not exposed
     to the LLM) + plain JSON-serialisable args.
  2. Applies RBAC + any further scope narrowing.
  3. Returns a dict with both the computed result AND citation metadata
     (source systems, filters applied, rows touched). The agent weaves these
     citations into its final answer — that is how "explainability" is wired.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .config import OUTPUT_DIR
from .data_loader import actuals_for, budget_for, projects_for, data_catalog
from .finance_glossary import GLOSSARY, lookup as glossary_lookup
from .rbac import RBACContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _apply_filters(df: pd.DataFrame, *, bu=None, region=None,
                   fiscal_year=None, fiscal_quarter=None, period=None,
                   account_category=None) -> pd.DataFrame:
    out = df
    if bu:               out = out[out["bu"] == bu]
    if region and "region" in out.columns: out = out[out["region"] == region]
    if fiscal_year:      out = out[out["fiscal_year"] == fiscal_year]
    if fiscal_quarter:   out = out[out["fiscal_quarter"] == fiscal_quarter]
    if period:           out = out[out["period"] == period]
    if account_category: out = out[out["account_category"] == account_category]
    return out


def _filters_description(filters: dict) -> str:
    active = [f"{k}={v}" for k, v in filters.items() if v]
    return ", ".join(active) if active else "no filters"


def _sum_by_category(df: pd.DataFrame) -> dict[str, float]:
    if df.empty:
        return {}
    return df.groupby("account_category")["amount_usd_mn"].sum().round(3).to_dict()


# ---------------------------------------------------------------------------
# Tool implementations — each returns JSON-serialisable data + citations
# ---------------------------------------------------------------------------
def tool_get_pnl_summary(ctx: RBACContext, *, bu: str | None = None,
                          region: str | None = None, fiscal_year: str | None = None,
                          fiscal_quarter: str | None = None,
                          period: str | None = None) -> dict[str, Any]:
    """Aggregate P&L by account category for the given scope."""
    df = actuals_for(ctx)
    filters = dict(bu=bu, region=region, fiscal_year=fiscal_year,
                   fiscal_quarter=fiscal_quarter, period=period)
    filtered = _apply_filters(df, **filters)
    cats = _sum_by_category(filtered)

    revenue = cats.get("Revenue", 0.0)
    cogs    = cats.get("COGS", 0.0)
    opex    = cats.get("Opex", 0.0)
    da      = cats.get("D&A", 0.0)
    finance = cats.get("Finance", 0.0)
    tax     = cats.get("Tax", 0.0)

    gross_profit = revenue + cogs                # COGS already negative
    ebitda = revenue + cogs + opex
    ebit   = ebitda + da
    net_income = ebit + finance + tax

    def pct(n, d): return round(n / d * 100, 2) if d else None

    return {
        "scope": ctx.scope_description(),
        "filters_applied": filters,
        "currency": "USD millions",
        "by_category": cats,
        "metrics": {
            "Revenue":       round(revenue, 3),
            "Gross Profit":  round(gross_profit, 3),
            "Gross Margin %": pct(gross_profit, revenue),
            "EBITDA":        round(ebitda, 3),
            "EBIT":          round(ebit, 3),
            "EBIT Margin %": pct(ebit, revenue),
            "Net Income":    round(net_income, 3),
            "Net Margin %":  pct(net_income, revenue),
        },
        "citations": [{
            "source": "SAP-ECC (sap_gl_actuals.csv)",
            "filters": _filters_description(filters),
            "rows": int(len(filtered)),
        }],
    }


def tool_get_variance(ctx: RBACContext, *, bu: str | None = None,
                       region: str | None = None, fiscal_year: str | None = None,
                       fiscal_quarter: str | None = None,
                       account_category: str | None = None) -> dict[str, Any]:
    """Actual vs Budget variance, optionally scoped to one category (e.g., Opex)."""
    if not ctx.can("read_budget"):
        return {"error": "Your role does not have budget data access.",
                "role": ctx.role}
    act_df = actuals_for(ctx)
    bud_df = budget_for(ctx)
    filters = dict(bu=bu, region=region, fiscal_year=fiscal_year,
                   fiscal_quarter=fiscal_quarter, account_category=account_category)
    act = _apply_filters(act_df, **filters)
    bud = _apply_filters(bud_df, **filters)

    actual = round(act["amount_usd_mn"].sum(), 3)
    budget = round(bud["amount_usd_mn"].sum(), 3)
    variance = round(actual - budget, 3)
    variance_pct = round(variance / abs(budget) * 100, 2) if budget else None

    # Favourable: revenue variance > 0 is good; cost variance < 0 is good.
    interpretation = None
    if account_category in {"COGS", "Opex", "D&A", "Finance", "Tax"}:
        interpretation = "Favourable" if variance > 0 else "Unfavourable"
        # For cost accounts, costs are negative → positive variance means lower costs than budget.
    elif account_category == "Revenue":
        interpretation = "Favourable" if variance > 0 else "Unfavourable"

    return {
        "scope": ctx.scope_description(),
        "filters_applied": filters,
        "currency": "USD millions",
        "actual":       actual,
        "budget":       budget,
        "variance":     variance,
        "variance_pct": variance_pct,
        "interpretation": interpretation,
        "citations": [
            {"source": "SAP-ECC (sap_gl_actuals.csv)",
             "filters": _filters_description(filters), "rows": int(len(act))},
            {"source": "SAP-BPC (sap_gl_budget.csv)",
             "filters": _filters_description(filters), "rows": int(len(bud))},
        ],
    }


def tool_get_metric_trend(ctx: RBACContext, *, metric: str,
                           bu: str | None = None, region: str | None = None,
                           fiscal_years: list[str] | None = None,
                           granularity: str = "year") -> dict[str, Any]:
    """Trend of a single metric over time.

    metric: one of Revenue | Gross Profit | EBIT | EBIT Margin % | Net Income.
    granularity: 'year' or 'quarter'.
    """
    df = actuals_for(ctx)
    if bu:     df = df[df["bu"] == bu]
    if region: df = df[df["region"] == region]
    if fiscal_years: df = df[df["fiscal_year"].isin(fiscal_years)]

    group_col = "fiscal_year" if granularity == "year" else "period"
    points: list[dict] = []
    for key, g in df.groupby(group_col):
        cats = _sum_by_category(g)
        rev = cats.get("Revenue", 0.0)
        cogs = cats.get("COGS", 0.0); opex = cats.get("Opex", 0.0); da = cats.get("D&A", 0.0)
        gp = rev + cogs
        ebit = rev + cogs + opex + da
        val = {
            "Revenue": rev,
            "Gross Profit": gp,
            "EBIT": ebit,
            "EBIT Margin %": round(ebit / rev * 100, 2) if rev else None,
            "Net Income": ebit + cats.get("Finance", 0.0) + cats.get("Tax", 0.0),
        }.get(metric)
        points.append({group_col: key, "value": round(val, 3) if val is not None else None})

    points.sort(key=lambda p: p[group_col])
    return {
        "metric": metric,
        "granularity": granularity,
        "scope": ctx.scope_description(),
        "filters_applied": {"bu": bu, "region": region, "fiscal_years": fiscal_years},
        "series": points,
        "citations": [{"source": "SAP-ECC (sap_gl_actuals.csv)",
                        "filters": _filters_description(
                            {"bu": bu, "region": region,
                             "fiscal_years": ",".join(fiscal_years) if fiscal_years else None}),
                        "rows": int(len(df))}],
    }


def tool_get_project_roi(ctx: RBACContext, *, project_name: str | None = None,
                          fiscal_years: list[str] | None = None) -> dict[str, Any]:
    """ROI trend for a project, or all visible projects if no name given."""
    df = projects_for(ctx)
    if project_name:
        df = df[df["project_name"].str.casefold() == project_name.casefold()]
    if fiscal_years:
        df = df[df["fiscal_year"].isin(fiscal_years)]
    if df.empty:
        return {"error": "No project data in your scope matches.",
                "scope": ctx.scope_description(),
                "requested": {"project_name": project_name, "fiscal_years": fiscal_years}}

    return {
        "scope": ctx.scope_description(),
        "records": df.to_dict(orient="records"),
        "citations": [{"source": "PPM-System (projects_roi.csv)",
                        "filters": f"project={project_name or '*'}",
                        "rows": int(len(df))}],
    }


def tool_lookup_glossary(ctx: RBACContext, *, term: str) -> dict[str, Any]:
    """Look up a finance term's definition and formula."""
    hit = glossary_lookup(term)
    if not hit:
        return {"term": term, "found": False,
                "available_terms": sorted(GLOSSARY.keys())}
    return {"term": term, "found": True, **hit,
            "citations": [{"source": "Internal Finance Glossary",
                            "filters": f"term={term}", "rows": 1}]}


def tool_describe_data_scope(ctx: RBACContext) -> dict[str, Any]:
    """Return what data the current user is allowed to see (for agent planning)."""
    return {
        "user": {"name": ctx.name, "role": ctx.role, "scope": ctx.scope_description()},
        "capabilities": ctx.capabilities,
        "catalog": data_catalog(ctx),
    }


def tool_generate_excel(ctx: RBACContext, *, filename: str, title: str,
                         rows: list[dict]) -> dict[str, Any]:
    """Write a summary table to an Excel file under outputs/."""
    ctx.require("export")
    if not rows:
        return {"error": "No rows provided to export."}
    try:
        from openpyxl import Workbook
    except ImportError:
        return {"error": "openpyxl not installed. `pip install openpyxl` to enable Excel export."}

    path = OUTPUT_DIR / filename
    wb = Workbook(); ws = wb.active; ws.title = "Summary"
    ws.append([title]); ws.append([])
    headers = list(rows[0].keys()); ws.append(headers)
    for r in rows:
        ws.append([r.get(h, "") for h in headers])
    wb.save(path)
    return {"generated_file": str(path), "rows": len(rows)}


def tool_generate_chart(ctx: RBACContext, *, filename: str, title: str,
                         x_label: str, y_label: str,
                         series: list[dict], chart_type: str = "line") -> dict[str, Any]:
    """Save a simple matplotlib chart (line or bar) to outputs/."""
    ctx.require("export")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return {"error": "matplotlib not installed. `pip install matplotlib`."}

    if not series:
        return {"error": "No series data provided."}

    path = OUTPUT_DIR / filename
    fig, ax = plt.subplots(figsize=(8, 4.5))
    xs = [p.get("x") for p in series]
    ys = [p.get("y") for p in series]
    if chart_type == "bar":
        ax.bar(xs, ys, color="#2b6cb0")
    else:
        ax.plot(xs, ys, marker="o", color="#2b6cb0", linewidth=2)
    ax.set_title(title); ax.set_xlabel(x_label); ax.set_ylabel(y_label)
    ax.grid(True, alpha=0.3)
    fig.tight_layout(); fig.savefig(path, dpi=120); plt.close(fig)
    return {"generated_file": str(path), "points": len(series)}


# ---------------------------------------------------------------------------
# Tool registry — schemas in Anthropic tool-use format
# ---------------------------------------------------------------------------
TOOL_SCHEMAS: list[dict] = [
    {
        "name": "describe_data_scope",
        "description": "List what data the current user has access to (BUs, regions, years, projects, capabilities). Call this FIRST if unsure what is visible to the user.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "lookup_glossary",
        "description": "Look up the definition and formula for a finance term (e.g., EBIT, Opex, ROI, variance). Call this when the user asks about a concept, or when you need the formula before computing.",
        "input_schema": {
            "type": "object",
            "properties": {"term": {"type": "string", "description": "Finance term to look up."}},
            "required": ["term"],
        },
    },
    {
        "name": "get_pnl_summary",
        "description": "Get aggregated P&L for a scope (revenue, gross profit, EBITDA, EBIT, net income). All amounts are USD millions. Scope filters are optional; omit to aggregate across the whole visible dataset.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bu":              {"type": "string", "description": "Business unit, e.g. 'Electronics'."},
                "region":          {"type": "string", "description": "Region, e.g. 'APAC'."},
                "fiscal_year":     {"type": "string", "description": "e.g. 'FY2024'."},
                "fiscal_quarter":  {"type": "string", "description": "'Q1' | 'Q2' | 'Q3' | 'Q4'."},
                "period":          {"type": "string", "description": "Month in YYYY-MM format."},
            },
            "required": [],
        },
    },
    {
        "name": "get_variance",
        "description": "Actual vs Budget variance for a scope and optional account category ('Opex', 'COGS', 'Revenue', etc.). Requires budget read permission.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bu":               {"type": "string"},
                "region":           {"type": "string"},
                "fiscal_year":      {"type": "string"},
                "fiscal_quarter":   {"type": "string"},
                "account_category": {"type": "string", "enum": ["Revenue", "COGS", "Opex", "D&A", "Finance", "Tax"]},
            },
            "required": [],
        },
    },
    {
        "name": "get_metric_trend",
        "description": "Time-series trend of a single metric across years or quarters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric":       {"type": "string", "enum": ["Revenue", "Gross Profit", "EBIT", "EBIT Margin %", "Net Income"]},
                "bu":           {"type": "string"},
                "region":       {"type": "string"},
                "fiscal_years": {"type": "array", "items": {"type": "string"}},
                "granularity":  {"type": "string", "enum": ["year", "quarter"], "default": "year"},
            },
            "required": ["metric"],
        },
    },
    {
        "name": "get_project_roi",
        "description": "Get ROI data for a project (e.g. 'Project Orion') across fiscal years, or for all visible projects.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_name": {"type": "string"},
                "fiscal_years": {"type": "array", "items": {"type": "string"}},
            },
            "required": [],
        },
    },
    {
        "name": "generate_chart",
        "description": "Generate a PNG chart (line or bar) from a series of {x, y} points. Saves to outputs/ and returns the path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "e.g. 'ebit_trend.png'"},
                "title":    {"type": "string"},
                "x_label":  {"type": "string"},
                "y_label":  {"type": "string"},
                "chart_type": {"type": "string", "enum": ["line", "bar"], "default": "line"},
                "series":   {"type": "array",
                              "items": {"type": "object",
                                          "properties": {"x": {}, "y": {"type": "number"}},
                                          "required": ["x", "y"]}},
            },
            "required": ["filename", "title", "x_label", "y_label", "series"],
        },
    },
    {
        "name": "generate_excel",
        "description": "Export tabular data to an Excel (.xlsx) file in outputs/.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {"type": "string"},
                "title":    {"type": "string"},
                "rows":     {"type": "array", "items": {"type": "object"}},
            },
            "required": ["filename", "title", "rows"],
        },
    },
]


# Dispatcher: name → python callable
TOOL_DISPATCH = {
    "describe_data_scope": tool_describe_data_scope,
    "lookup_glossary":     tool_lookup_glossary,
    "get_pnl_summary":     tool_get_pnl_summary,
    "get_variance":        tool_get_variance,
    "get_metric_trend":    tool_get_metric_trend,
    "get_project_roi":     tool_get_project_roi,
    "generate_chart":      tool_generate_chart,
    "generate_excel":      tool_generate_excel,
}


def run_tool(name: str, ctx: RBACContext, args: dict) -> dict:
    """Invoke a tool by name with RBAC context. Returns a JSON-serialisable dict.

    Any PermissionError or unexpected exception is caught and returned as an
    `error` field so the LLM can recover gracefully.
    """
    fn = TOOL_DISPATCH.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(ctx, **(args or {}))
    except PermissionError as e:
        return {"error": "permission_denied", "message": str(e)}
    except Exception as e:
        return {"error": type(e).__name__, "message": str(e)}
