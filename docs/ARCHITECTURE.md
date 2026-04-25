# Ask Finance — Architecture

## 1. System overview

```
                ┌──────────────────────────────────────────────────┐
                │         Ask Finance — Agent System                │
                └──────────────────────────────────────────────────┘

  ┌──────────┐    ┌──────────┐    ┌────────────┐    ┌─────────────┐
  │ Web /    │    │ Enterprise│    │ Identity   │    │ LLM         │
  │ Slack /  │◀──▶│ SSO       │◀──▶│ Provider   │    │ (Claude /   │
  │ Teams UI │    │ (Okta/AAD)│    │ roles+scope│    │  GPT-4o /   │
  └────┬─────┘    └──────────┘    └────┬───────┘    │  internal)  │
       │                               │             └──────┬──────┘
       ▼                               ▼                    │
  ┌────────────────────────────────────────────────────────┴─────┐
  │                  Agent Orchestration Layer                    │
  │                                                               │
  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
  │  │ RBAC context │→│ System prompt │→│ Tool-use loop      │ │
  │  │ (role, scope)│  │ builder       │  │ (Claude tools API) │ │
  │  └──────────────┘  └──────────────┘  └────────┬───────────┘ │
  │                                                ▼              │
  │  ┌──────────────────────────────────────────────────────────┐│
  │  │                  Tool Dispatcher (Python)                 ││
  │  │  describe_data_scope │ lookup_glossary │ get_pnl_summary  ││
  │  │  get_variance │ get_metric_trend │ get_project_roi        ││
  │  │  generate_chart │ generate_excel                          ││
  │  └────────┬────────────────────────┬────────────────────────┘│
  │           │                        │                          │
  │           ▼                        ▼                          │
  │  ┌─────────────────┐   ┌───────────────────┐                 │
  │  │ RBAC Filter     │   │ Finance Glossary  │                 │
  │  │ (re-enforced)   │   │ + formulas        │                 │
  │  └────────┬────────┘   └───────────────────┘                 │
  └───────────┼──────────────────────────────────────────────────┘
              ▼
  ┌───────────────────────────────────────────────────────────────┐
  │                    Data Layer                                  │
  │   SAP-ECC   │   SAP-BPC   │   HFM   │   PPM   │   Data Lake    │
  │  (actuals)  │  (budget)   │ (cons.) │ (proj.) │ (unstructured) │
  └───────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  Cross-cutting:   Audit log (JSONL)   │   Secrets manager    │
  └─────────────────────────────────────────────────────────────┘
```

---

## 2. Components in detail

### 2.1 User interface
- **Prototype**: Streamlit web app (`src/app.py`) with user-persona picker and
  example-query buttons.
- **Production**: identical agent API wrapped in a Teams bot, Slack app, or
  React UI. The orchestrator itself is UI-agnostic — it takes
  `(RBACContext, user_query)` and returns a `Trace`.

### 2.2 Identity & RBAC (`src/rbac.py`)
- The SSO provider (Okta / Azure AD) authenticates the user and issues a
  JWT that names the user's **role** and two **scope** fields
  (`bu_scope`, `region_scope`). In the prototype this is simulated via
  `data/users.json`.
- `RBACContext` encodes: `role → capabilities` (e.g. `read_budget`, `export`)
  + `bu_scope` + `region_scope`.
- Enforcement is **two-layered** and **defence in depth**:

  | Layer | Where | What it does |
  |---|---|---|
  | Prompt | `agent.build_system_prompt()` | Tells the LLM its scope so it plans sensible tool calls |
  | **Hard enforcement** | Every function in `data_loader.py` and `tools.py` | Re-checks capabilities + filters DataFrames server-side |

  The LLM is never trusted to enforce permissions — if the prompt were
  subverted (prompt injection, jailbreak), the Python layer still blocks
  out-of-scope access.

Five roles are implemented (see `rbac.py#ROLE_CAPABILITIES`):

| Role                  | BU scope    | Region scope | Budget | Export |
|-----------------------|-------------|--------------|--------|--------|
| Group CFO             | * (all)     | * (all)      | ✅     | ✅     |
| BU General Manager    | 1           | *            | ✅     | ✅     |
| Regional Finance BP   | *           | 1            | ✅     | ✅     |
| BU Finance BP         | 1           | 1            | ✅     | ✅     |
| Analyst               | 1           | 1            | ❌     | ❌     |

### 2.3 Data layer (`src/data_loader.py`, `data/*.csv`)

Mock datasets stand in for real systems:

| File                    | Real-world analogue              | Shape |
|-------------------------|----------------------------------|-------|
| `sap_gl_actuals.csv`    | SAP-ECC general ledger actuals   | 3,564 rows: period × BU × region × account |
| `sap_gl_budget.csv`     | SAP-BPC / BCS budget plan        | same |
| `hfm_consolidated.csv`  | Oracle HFM consolidated data     | 1,188 rows: group-level roll-up |
| `projects_roi.csv`      | PPM system (Planview / Clarity)  | strategic projects × year (incl. Project Orion) |
| `users.json`            | SSO / HRIS directory             | 5 simulated users |

Every access is a scoped read:
```python
actuals_for(ctx)    # → pd.DataFrame filtered by ctx.bu_scope / ctx.region_scope
budget_for(ctx)     # → raises PermissionError if ctx lacks 'read_budget'
projects_for(ctx)   # → only projects whose (bu, region) fall inside scope
```

### 2.4 Finance domain knowledge (`src/finance_glossary.py`)
A curated dictionary of canonical finance terms (P&L, Opex, EBIT, ROI,
variance, gross margin, …) with:
- plain-language **definition**,
- **formula** spelling out which account categories roll in,
- list of relevant `account_category` values.

Called by the agent via the `lookup_glossary` tool.
In production this graduates to a **vector store** (FAISS / Pinecone / pgvector)
populated from the finance controller's internal wiki + accounting policy
manual, then retrieved via semantic search (RAG).

### 2.5 Tools (`src/tools.py`)
Eight tools are exposed to the LLM with JSON schemas in Anthropic tool-use
format. Every tool:

1. Takes the bound `RBACContext` (not exposed to the LLM — injected by the dispatcher).
2. Calls the scoped data loader.
3. Returns `{ ...results, citations: [{source, filters, rows}, ...] }`.

The **citations contract** is what powers explainability: every number in the
final answer traces back to a specific source file and filter set.

| Tool | Purpose |
|---|---|
| `describe_data_scope`   | What can this user see? (for agent planning) |
| `lookup_glossary`       | Finance term definition + formula |
| `get_pnl_summary`       | Aggregate P&L (Rev / GP / EBITDA / EBIT / NI) for a scope |
| `get_variance`          | Actual vs Budget, optionally by account category |
| `get_metric_trend`      | Time series of one metric across years/quarters |
| `get_project_roi`       | Project-level ROI over years |
| `generate_chart`        | Line/bar PNG → `outputs/` |
| `generate_excel`        | Tabular export → `outputs/*.xlsx` |

### 2.6 Orchestration (`src/agent.py`)
Transparent tool-calling loop — no heavyweight framework:

```
user_query
   │
   ▼
build_system_prompt(ctx)            ← embeds role + scope + catalog
   │
   ▼
client.messages.create(tools=…)     ← Claude sees tool schemas
   │
   ├──(tool_use blocks)──▶ dispatcher.run_tool(name, ctx, args)
   │                            │
   │                            ▼
   │                       RBAC-checked Python fn
   │                            │
   │                            ▼
   │                       {result, citations}
   │                            │
   └───────────(append tool_result)─┐
                                    ▼
                            next LLM turn
                                    │
                             (text only → done)
                                    ▼
                               final answer
```

Design choices:
- **Bounded loop** — `MAX_TOOL_ITERATIONS = 8` prevents runaway tool use.
- **Mock provider fallback** — a keyword-driven planner runs when
  `ANTHROPIC_API_KEY` is absent, so reviewers can test the full E2E flow
  offline.
- **Pluggable provider** — swap in OpenAI, Bedrock, Azure OpenAI, or an
  internal model by adding one function; the tool schemas are
  JSON Schema so they transfer.

### 2.7 Output generation
- **Tables** → markdown in the answer.
- **Charts** → `matplotlib` → PNG in `outputs/`, streamed to UI.
- **Excel** → `openpyxl` → xlsx in `outputs/`, offered as download.
- **PowerPoint** → `python-pptx` (trivial extension — not wired in the
  prototype but demonstrated in `FUTURE_ENHANCEMENTS.md`).

### 2.8 Audit log (`src/audit.py`)
Every `user_query`, `tool_call`, and `agent_response` is appended to
`outputs/audit_log.jsonl`. This is the security-compliance substrate:
- Who asked what.
- Which tools fired with which filters.
- Whether the call was permitted or denied.
- How many iterations the agent took.

In production this would ship to SIEM (Splunk / Elastic / Datadog).

---

## 3. Prompt design

The system prompt (built per-request in `agent.build_system_prompt`):

1. **Identifies the user** — name, role, scope, visible BUs/regions/projects.
2. **Lists the contract** — 7 hard rules: cite every number, never invent
   data, respect scope, prefer tables, be concise, etc.
3. **Specifies output format** — headline → detail → Sources block.

The rest (tool descriptions, argument schemas) is delivered via Anthropic's
native `tools` parameter, not in the prompt text — keeping the prompt short
and the schemas machine-validated.

---

## 4. Security & accuracy controls

| Concern | Control |
|---|---|
| **Unauthorized data access** | RBAC enforced in Python at every tool call; 8 automated tests in `tests/test_rbac.py`; append-only audit log |
| **LLM hallucinating numbers** | Tool results are the single source of truth; prompt rule "never invent numbers"; every numeric claim must cite a source |
| **Prompt injection** | LLM cannot call arbitrary code — only the 8 registered tools with validated JSON schemas. RBAC is enforced by Python, not by the model |
| **PII / sensitive exfiltration** | Audit log captures all queries → DLP rules can flag anomalous patterns; `users.json` contains only business identifiers (no PII) |
| **Secrets** | `ANTHROPIC_API_KEY` via env var; no keys in code or data |
| **Model / schema drift** | Tool schemas are JSON Schema; a bad argument from the LLM surfaces as an error the agent can recover from |
| **Formula correctness** | Finance formulas live in `finance_glossary.py` and `tools.py` (Python) — deterministic, unit-testable — NOT in the LLM |

---

## 5. Example trace (end-to-end)

**Query** (Group CFO): _"What's our EBIT margin trend for FY2023–FY2025?"_

1. System prompt built with Sarah's scope (`*, *`, all BUs + regions visible).
2. LLM chooses tool `get_metric_trend` with
   `{metric: "EBIT Margin %", fiscal_years: ["FY2023","FY2024","FY2025"]}`.
3. Dispatcher: `actuals_for(ctx)` returns full 3,564 rows (CFO scope).
4. Tool aggregates by `fiscal_year`, computes `(Revenue − COGS − Opex − D&A)/Revenue`.
5. Returns `{series: [{fiscal_year: "FY2023", value: 19.71}, …], citations: [...]}`.
6. LLM composes final answer with table + **Sources: SAP-ECC (sap_gl_actuals.csv)**.

Full trace (tool inputs + results) is surfaced in the Streamlit UI under
"🔍 Tool calls & raw data".
