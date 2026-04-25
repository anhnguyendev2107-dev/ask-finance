# Ask Finance — AI Finance Business Partner

> A Finance-focused AI Agent that lets managers ask natural-language questions
> like _"What was our Opex variance for Q2 in Electronics?"_ and get
> accurate, **explainable**, **role-scoped** answers over enterprise finance
> data (SAP, HFM, project-portfolio systems).

This repo is the prototype deliverable for the **Ask Finance** assessment.
It demonstrates end-to-end thinking: architecture, orchestration, data
integration, RBAC, finance-domain knowledge, and output generation — wired
up with mock SAP/HFM data so the full flow runs locally.

---

## Quick start

```bash
# 1. Install
pip install -r requirements.txt

# 2. Generate the mock data (already checked in, but this re-seeds it)
python data/generate_mock_data.py

# 3. (Optional) enable live Claude — otherwise a deterministic mock planner runs
cp .env.example .env   # fill in ANTHROPIC_API_KEY
export $(cat .env | xargs)

# 4A. Run the Streamlit app
streamlit run src/app.py

# 4B. …or open the Jupyter notebook demo
jupyter lab notebooks/ask_finance_demo.ipynb

# 5. Run the RBAC test suite
pytest tests/ -v
```

### Sample queries to try

| Ask as… | Query | What happens |
|---|---|---|
| **Group CFO** (Sarah) | "What's our EBIT margin trend for FY2023–FY2025?" | Full group rollup |
| **BU GM Electronics** (Marcus) | "What was our Opex variance for Q2 FY2024?" | Electronics-only, all regions |
| **APAC BP** (Priya) | "ROI trend of Project Orion over 3 years" | Orion visible (Orion ∈ APAC) |
| **Automotive-Americas BP** (Diego) | "ROI of Project Orion?" | "No project data in your scope" |
| **Analyst** (Yuki) | "Show Opex variance vs budget" | Denied — no budget capability |

---

## Repository layout

```
ask-finance/
├── data/                         # mock SAP + HFM + project CSVs + users.json
│   ├── generate_mock_data.py
│   ├── sap_gl_actuals.csv        # SAP-ECC general ledger — actuals
│   ├── sap_gl_budget.csv         # SAP-BPC budget
│   ├── hfm_consolidated.csv      # HFM consolidated monthly
│   ├── projects_roi.csv          # strategic-project ROI (incl. Orion)
│   └── users.json                # 5 simulated users / roles
├── src/
│   ├── config.py                 # env + paths
│   ├── rbac.py                   # roles, capabilities, scope filters
│   ├── data_loader.py            # scoped reads → pandas
│   ├── finance_glossary.py       # P&L, Opex, EBIT, ROI definitions + formulas
│   ├── tools.py                  # 8 tools the LLM can call (+ JSON schemas)
│   ├── audit.py                  # append-only JSONL audit log
│   ├── agent.py                  # Claude tool-use loop (+ mock planner)
│   └── app.py                    # Streamlit web UI
├── notebooks/
│   └── ask_finance_demo.ipynb    # end-to-end walkthrough
├── tests/
│   └── test_rbac.py              # 8 RBAC enforcement tests
├── docs/
│   ├── ARCHITECTURE.md
│   ├── EVALUATION.md
│   └── FUTURE_ENHANCEMENTS.md
├── outputs/                      # generated Excel/charts + audit_log.jsonl
├── requirements.txt
└── .env.example
```

---

## What's in the box — the five functional goals

| # | Goal | Where it lives |
|---|---|---|
| 1 | **Ingest & understand financial data** | `data/*.csv` + `data_loader.py` (mock SAP-ECC, SAP-BPC, HFM, PPM) |
| 2 | **Respond to user queries** | `agent.py` → Claude tool-use loop |
| 3 | **Role-based access control** | `rbac.py` (5 roles × 4 capabilities), enforced at every tool call |
| 4 | **Explain its answers** | Every tool result includes `citations[]`; system prompt requires a **Sources:** block in every answer |
| 5 | **Business-friendly output** | `generate_chart` (PNG), `generate_excel` (xlsx); PowerPoint is a trivial extension via `python-pptx` |

---

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, orchestration, security
- [docs/EVALUATION.md](docs/EVALUATION.md) — how to measure accuracy, consistency, explainability, security compliance, latency
- [docs/FUTURE_ENHANCEMENTS.md](docs/FUTURE_ENHANCEMENTS.md) — scaling across BUs, real SAP/HFM connectors, embeddings for finance knowledge
