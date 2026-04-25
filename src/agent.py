"""Ask Finance agent orchestration.

A simple, transparent tool-calling loop:

    user_query  ──►  LLM  ──►  (tool_use? → run_tool → append result) loop
                                  │
                                  ▼
                            final text answer + citations

Design notes
------------
* The loop is bounded by `MAX_TOOL_ITERATIONS` (config) to prevent runaway calls.
* The system prompt teaches the model the user's scope, the available tools,
  and the "cite every numeric claim" contract.
* RBAC is NOT enforced by the LLM — every tool re-checks permissions in Python.
  The model sees its scope only to plan sensible tool calls.
* A `mock` provider is included so the prototype runs without an API key —
  it uses keyword heuristics to pick tools. Use `anthropic` for real LLM calls.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from . import audit
from .config import LLM_MODEL, LLM_PROVIDER, LLM_MAX_TOKENS, MAX_TOOL_ITERATIONS
from .data_loader import data_catalog
from .rbac import RBACContext
from .tools import TOOL_SCHEMAS, run_tool


SYSTEM_PROMPT_TEMPLATE = """You are **Ask Finance**, an AI Finance Business Partner inside a large multi-BU conglomerate.

## Current user
- Name: {name}
- Role: {role}
- Data scope: {scope}
- Budget access: {budget_access}
- Visible BUs: {bus}
- Visible regions: {regions}
- Visible projects: {projects}

## Your contract
1. Understand finance domain terms (P&L, Opex, EBIT, ROI, variance, cash flow, etc.).
   If the user uses a term you'd want to double-check, call `lookup_glossary` first.
2. For any numeric claim you make, you MUST have called a data tool (`get_pnl_summary`,
   `get_variance`, `get_metric_trend`, `get_project_roi`) — never invent numbers.
3. Always cite your sources in the final answer. Put citations in a "Sources:" list at
   the end, naming the source system (e.g. "SAP-ECC", "SAP-BPC", "HFM", "PPM-System")
   and the filters applied.
4. Respect the user's scope. Do not attempt to access BUs or regions outside it;
   the data tools will filter anyway, but you should not mislead the user.
5. If the user asks for data they can't see (e.g. Analyst asks for budget variance),
   explain the permission constraint and suggest who to contact (Finance Admin).
6. Prefer tables for numbers; use `generate_chart` for trends when helpful;
   use `generate_excel` when the user explicitly asks for an export.
7. Be concise. Management audience — lead with the answer, then show the detail.

## Output format
- Start with a one-sentence headline answer.
- Follow with a brief breakdown (bullets or a small table).
- End with a "Sources:" list.
"""


def build_system_prompt(ctx: RBACContext) -> str:
    cat = data_catalog(ctx)
    return SYSTEM_PROMPT_TEMPLATE.format(
        name=ctx.name, role=ctx.role, scope=ctx.scope_description(),
        budget_access=ctx.can("read_budget"),
        bus=", ".join(cat["actuals"]["business_units"]) or "(none)",
        regions=", ".join(cat["actuals"]["regions"]) or "(none)",
        projects=", ".join(cat["projects"]["projects"]) or "(none)",
    )


@dataclass
class AgentTrace:
    """Full trace of an agent run, for debugging + UI display."""
    user_query: str
    user_id: str
    iterations: int = 0
    tool_calls: list[dict] = field(default_factory=list)
    final_text: str = ""
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "user_query": self.user_query, "user_id": self.user_id,
            "iterations": self.iterations, "tool_calls": self.tool_calls,
            "final_text": self.final_text, "error": self.error,
        }


# ---------------------------------------------------------------------------
# Anthropic provider
# ---------------------------------------------------------------------------
def _run_with_anthropic(ctx: RBACContext, user_query: str,
                         trace: AgentTrace) -> AgentTrace:
    try:
        from anthropic import Anthropic
    except ImportError:
        trace.error = "anthropic SDK not installed. `pip install anthropic`."
        return trace

    client = Anthropic()
    system = build_system_prompt(ctx)
    messages: list[dict] = [{"role": "user", "content": user_query}]

    for i in range(MAX_TOOL_ITERATIONS):
        trace.iterations = i + 1
        resp = client.messages.create(
            model=LLM_MODEL, max_tokens=LLM_MAX_TOKENS,
            system=system, tools=TOOL_SCHEMAS, messages=messages,
        )

        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            texts = [b.text for b in resp.content if b.type == "text"]
            trace.final_text = "\n".join(texts).strip()
            return trace

        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        tool_results = []
        for tu in tool_uses:
            result = run_tool(tu.name, ctx, tu.input or {})
            trace.tool_calls.append({"name": tu.name, "input": tu.input, "result": result})
            audit.log("tool_call", ctx.user_id,
                       {"tool": tu.name, "input": tu.input,
                        "ok": "error" not in result, "role": ctx.role})
            tool_results.append({
                "type": "tool_result", "tool_use_id": tu.id,
                "content": json.dumps(result, default=str),
            })
        messages.append({"role": "user", "content": tool_results})

        if resp.stop_reason == "end_turn":
            texts = [b.text for b in resp.content if b.type == "text"]
            trace.final_text = "\n".join(texts).strip()
            return trace

    trace.error = f"Hit max iteration cap ({MAX_TOOL_ITERATIONS})."
    return trace


# ---------------------------------------------------------------------------
# Mock provider — keyword-driven planner, no API key required
# ---------------------------------------------------------------------------
def _run_with_mock(ctx: RBACContext, user_query: str,
                    trace: AgentTrace) -> AgentTrace:
    """Deterministic, zero-dependency planner for demos without an LLM.

    Pattern-matches a handful of intents → tool calls → templated response.
    Not intended to replace the real LLM — just to let reviewers run the demo
    end-to-end without an API key.
    """
    q = user_query.lower()

    def call(name, **args):
        res = run_tool(name, ctx, args)
        trace.tool_calls.append({"name": name, "input": args, "result": res})
        return res

    # --- intent: explain a term --------------------------------------------
    m = re.search(r"what (?:is|does) ([\w &]+)\??$", q)
    if m or "define" in q or "explain" in q:
        term = m.group(1).strip() if m else _guess_term(q) or "EBIT"
        g = call("lookup_glossary", term=term)
        if g.get("found"):
            trace.final_text = (
                f"**{g['term']}** — {g['definition']}\n\n"
                f"Formula: `{g['formula']}`\n\n"
                f"Sources: Internal Finance Glossary."
            )
        else:
            trace.final_text = f"I couldn't find a definition for '{term}'."
        return trace

    # --- intent: variance (actual vs budget) -------------------------------
    if "variance" in q or ("actual" in q and "budget" in q):
        bu  = _detect_bu(q, ctx)
        fy  = _detect_fy(q) or "FY2024"
        qtr = _detect_quarter(q)
        cat = "Opex" if "opex" in q else ("COGS" if "cogs" in q else None)
        v = call("get_variance", bu=bu, fiscal_year=fy, fiscal_quarter=qtr,
                  account_category=cat)
        if "error" in v:
            trace.final_text = f"⚠️ {v.get('message', v['error'])}"
        else:
            trace.final_text = (
                f"**{cat or 'Total'} variance — {fy} {qtr or ''} {bu or ctx.scope_description()}**: "
                f"actual ${v['actual']}M vs budget ${v['budget']}M → "
                f"variance ${v['variance']}M ({v['variance_pct']}%, {v['interpretation'] or 'n/a'}).\n\n"
                f"Sources: SAP-ECC actuals + SAP-BPC budget."
            )
        return trace

    # --- intent: ROI trend of a project ------------------------------------
    m = re.search(r"project\s+([a-z]+)", q)
    if "roi" in q or "project" in q or m:
        proj = None
        if m:
            proj = "Project " + m.group(1).title()
        r = call("get_project_roi", project_name=proj)
        if "error" in r:
            trace.final_text = f"⚠️ {r['error']}"
        else:
            lines = ["| Year | Investment ($M) | Returns ($M) | ROI % |", "|---|---|---|---|"]
            for rec in r["records"]:
                lines.append(f"| {rec['fiscal_year']} | {rec['investment_usd_mn']} | "
                              f"{rec['returns_usd_mn']} | {rec['roi_pct']}% |")
            trace.final_text = (f"**ROI trend — {proj or 'all visible projects'}**\n\n"
                                 + "\n".join(lines) +
                                 "\n\nSources: PPM-System (projects_roi.csv).")
        return trace

    # --- intent: metric trend ---------------------------------------------
    if "trend" in q or "over the last" in q or "ebit margin" in q:
        metric = "EBIT Margin %" if "margin" in q else ("Revenue" if "revenue" in q else "EBIT")
        bu = _detect_bu(q, ctx)
        fy_match = re.findall(r"fy(20\d\d)", q)
        fys = [f"FY{y}" for y in fy_match] or None
        # expand "FY2023 through/to/- FY2025" style ranges
        if fys and len(fys) == 2 and re.search(r"(through|to|-|–|—)", q):
            start, end = int(fys[0][2:]), int(fys[1][2:])
            if start < end:
                fys = [f"FY{y}" for y in range(start, end + 1)]
        t = call("get_metric_trend", metric=metric, bu=bu, fiscal_years=fys,
                  granularity="year")
        if not t.get("series"):
            trace.final_text = "No data available for that scope."
        else:
            lines = [f"| {t['granularity'].title()} | {metric} |", "|---|---|"]
            for p in t["series"]:
                k = p.get("fiscal_year") or p.get("period")
                lines.append(f"| {k} | {p['value']} |")
            trace.final_text = (f"**{metric} trend — {bu or ctx.scope_description()}**\n\n"
                                 + "\n".join(lines) +
                                 "\n\nSources: SAP-ECC (sap_gl_actuals.csv).")
        return trace

    # --- intent: P&L summary ----------------------------------------------
    if "p&l" in q or "pnl" in q or "summarize" in q or "summary" in q:
        bu  = _detect_bu(q, ctx)
        fy  = _detect_fy(q)
        qtr = _detect_quarter(q)
        s = call("get_pnl_summary", bu=bu, fiscal_year=fy, fiscal_quarter=qtr)
        m = s["metrics"]
        trace.final_text = (
            f"**P&L snapshot — {s['scope']}** ({fy or 'all years'} {qtr or ''})\n\n"
            f"- Revenue: ${m['Revenue']}M\n"
            f"- Gross Profit: ${m['Gross Profit']}M (margin {m['Gross Margin %']}%)\n"
            f"- EBIT: ${m['EBIT']}M (margin {m['EBIT Margin %']}%)\n"
            f"- Net Income: ${m['Net Income']}M (margin {m['Net Margin %']}%)\n\n"
            f"Sources: SAP-ECC (sap_gl_actuals.csv)."
        )
        return trace

    # --- fallback ----------------------------------------------------------
    cap = call("describe_data_scope")
    trace.final_text = (
        "I can help with P&L summaries, variance (actual vs budget), metric trends, "
        "project ROI, and finance-term definitions. Try e.g. "
        "*'What was Opex variance for Q2 in Electronics in FY2024?'*\n\n"
        f"Your visible data: {json.dumps(cap['catalog'], default=str)}"
    )
    return trace


def _detect_bu(q: str, ctx: RBACContext) -> str | None:
    for bu in ["Electronics", "Automotive", "Healthcare"]:
        if bu.lower() in q:
            return bu
    return None


def _detect_fy(q: str) -> str | None:
    m = re.search(r"fy(20\d\d)", q)
    if m: return f"FY{m.group(1)}"
    m = re.search(r"(20\d\d)", q)
    return f"FY{m.group(1)}" if m else None


def _detect_quarter(q: str) -> str | None:
    m = re.search(r"q([1-4])", q)
    return f"Q{m.group(1)}" if m else None


def _guess_term(q: str) -> str | None:
    for t in ["ebit margin", "ebitda", "ebit", "opex", "cogs", "roi",
               "variance", "gross margin", "revenue", "net income", "p&l"]:
        if t in q:
            return t
    return None


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
def ask(ctx: RBACContext, user_query: str,
        provider: str | None = None) -> AgentTrace:
    """Run the agent against a user query. Returns the full trace."""
    trace = AgentTrace(user_query=user_query, user_id=ctx.user_id)
    audit.log("user_query", ctx.user_id,
               {"query": user_query, "role": ctx.role,
                "scope": ctx.scope_description()})

    provider = provider or LLM_PROVIDER
    if provider == "anthropic" and os.getenv("ANTHROPIC_API_KEY"):
        trace = _run_with_anthropic(ctx, user_query, trace)
    else:
        trace = _run_with_mock(ctx, user_query, trace)
        if provider == "anthropic" and trace.error is None:
            # Note fallback reason but keep the run marked successful
            trace.final_text += "\n\n> _Note: running in mock mode (no ANTHROPIC_API_KEY set)._"

    audit.log("agent_response", ctx.user_id, {
        "iterations": trace.iterations,
        "tool_calls": [tc["name"] for tc in trace.tool_calls],
        "ok": trace.error is None,
    })
    return trace
