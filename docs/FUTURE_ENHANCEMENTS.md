# Future Enhancements — Ask Finance

The prototype proves the architecture. This document lays out what changes
when scaling from a mock-data prototype to a production rollout across a
multi-BU conglomerate.

---

## 1. Real enterprise connectors

Replace the mock CSVs in `data/` with live connectors. The `data_loader` API
stays the same — only the body changes.

| Source system   | Connector                | Refresh  | Notes |
|-----------------|--------------------------|----------|-------|
| **SAP S/4HANA** | SAP OData / CDS Views via `pyrfc` or SAP Graph | hourly | OAuth client-credentials; named ranges per company code |
| **SAP BPC**     | BPC BW API or Analysis for Office exports | daily | Budget snapshots versioned by plan cycle |
| **Oracle HFM**  | HFM web-services (`hfmws`) or Smart View extracts landed to S3 | monthly (post-close) | Mapped through a consolidation hierarchy table |
| **Planview / Clarity PPM** | REST API | daily | Project master + monthly actuals |
| **Data lake**   | Databricks SQL / Snowflake | on-demand | For unstructured narrative + operational KPIs |

Implementation pattern — **adapter + caching**:

```
connectors/
  sap_odata.py       → def fetch_gl_actuals(bu, period_range) → DataFrame
  hfm_smartview.py   → def fetch_consolidated(entity, period) → DataFrame
  ppm_api.py         → def fetch_projects(bu) → DataFrame
```

All adapters return the same normalised schema the current `data_loader`
expects, so the rest of the system is unchanged. Results land in a
**Delta / Iceberg table** for fast re-reads and reproducibility.

---

## 2. Finance-knowledge embeddings (RAG for the glossary)

Today's glossary is a hard-coded dict. At scale, embed:

- Controller's internal wiki / accounting policy manual.
- BU-specific KPI definitions (they differ: "Bookings" ≠ "Orders" ≠ "Revenue").
- Legal entity mappings.
- Historical CFO commentary and board decks (for "how do we usually talk about Opex?").

Stack:

```
docs (PDF/Confluence/SharePoint)
   │
   ▼
chunker (1k tokens, 200-overlap)
   │
   ▼
embeddings (Claude haiku embeddings / text-embedding-3-large)
   │
   ▼
vector store (pgvector / Pinecone / OpenSearch)
   │
   ▼
lookup_knowledge(query, k=5, filter_by_bu=ctx.bu_scope)
```

**Critical**: the RBAC filter passes through RAG too. A BU GM should not
retrieve another BU's commentary. Tag every chunk with `bu`, `region`,
`sensitivity_level` and filter at query time.

---

## 3. Scaling across BUs

The prototype handles 3 BUs × 3 regions × 12 accounts. Real conglomerates:
~20–50 BUs, ~10 regions, 1000+ accounts, dozens of sub-ledgers.

What changes:

- **Semantic layer** — an LLM shouldn't guess that "marketing spend" maps
  to `6200`. Introduce a business-friendly name registry (dbt metrics, Cube.js,
  or Looker's LookML) and have tools take metric names, not account codes.
- **Currency & FX** — tools must accept a `report_currency` arg; revenue in
  local currency → translated at BU-specific FX rates per period.
- **Consolidation & eliminations** — intercompany eliminations live in HFM;
  group-level P&L ≠ sum of BU P&Ls. The `hfm_for()` loader is the right
  source for group totals.
- **Period close awareness** — add a "close calendar" tool: "Has Q3 closed
  for Electronics?" — critical for CFO to know whether numbers are actuals
  or flash estimates.
- **Dimensional RBAC** — roles gain more scope dimensions (legal entity,
  product line, customer segment). `RBACContext` becomes dict-based:
  `scope: {bu: [...], region: [...], legal_entity: [...]}`.

---

## 4. Output generation upgrades

- **PowerPoint** — trivial to add via `python-pptx`: one new tool
  `generate_powerpoint(filename, title, sections)` where sections are
  `{title, bullets, chart_path}`. Template-driven using the Finance team's
  brand deck.
- **Conditional formatting in Excel** — variance cells coloured
  red/green/yellow by threshold; sparklines for trends.
- **Embedded dashboards** — for recurring questions ("monthly P&L flash"),
  pre-compute and cache; the agent returns a link to a live Tableau/Power BI
  dashboard instead of regenerating charts.

---

## 5. Memory & personalisation

Store per-user preferences and recurring-query shortcuts:

- "Every Monday 9 AM, send me my P&L flash" → scheduled run.
- Remember that "my region" for Priya means APAC.
- Remember that Marcus prefers tables over charts.

Stored in a user-memory table — orthogonal to RBAC (memory never expands scope).

---

## 6. Multilingual support

The prompt asks for optional multilingual. Two options:

1. **Model-level** (recommended) — Claude handles Vietnamese, Mandarin, Japanese,
   French natively. No code change; just a `preferred_language` in the user profile
   that gets passed to the system prompt.
2. **Translation shim** — if an on-prem model that is English-only is mandated
   for compliance, detect input language → translate → run the agent in English
   → translate final answer back. Adds ~1s latency and a new failure mode
   (translation drift in finance terms — risky).

---

## 7. Advanced agent capabilities

- **Multi-step planning** — LangGraph state machine for complex questions
  like "Explain the drivers of our Q2 margin decline in Automotive-EMEA."
  The current single-pass tool loop is enough for point questions; driver
  analysis needs a planner → subqueries → synthesis flow.
- **Natural-language-to-SQL (carefully)** — for ad-hoc queries outside the
  pre-built tools. Gated behind a semantic-layer abstraction (no raw SQL to
  the warehouse) and always executed with `ctx`'s DB role, not an elevated
  service account.
- **Anomaly explainer** — nightly job that scans `outputs/audit_log.jsonl`
  for cost-line anomalies (MAD-based outliers per BU), generates a draft
  "why did this change?" narrative, and drops it in the BP's Teams channel
  for review.
- **Tool certifications** — formal review + sign-off by Finance Control
  before a new tool goes live. Tools are the surface where the LLM meets
  the ledger; they need the rigour of a report, not the agility of a
  prompt.

---

## 8. Productionisation checklist

- [ ] Replace mock providers with real SAP/HFM/PPM connectors (§ 1).
- [ ] Move RBAC source-of-truth from `users.json` to SSO + HRIS sync.
- [ ] Prompt caching (Anthropic) on the static system-prompt prefix → ~60 % latency cut.
- [ ] Observability: OTel traces for every `ask()` call; per-tool latency SLOs.
- [ ] Rate limits + cost caps per user; per-BU token budgets.
- [ ] Red-team review quarterly; pen-test annually.
- [ ] Feedback capture — thumbs up/down on every answer; feeds back into the
      golden-set curation loop.
- [ ] Disaster scenarios — what if the LLM is down? Degrade gracefully to a
      tool-only "report generator" that still works for common queries.
