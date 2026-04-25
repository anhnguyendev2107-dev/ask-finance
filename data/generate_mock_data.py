"""Generate deterministic mock SAP/HFM finance datasets for the Ask Finance prototype.

Run once:  python data/generate_mock_data.py
Outputs to data/ as CSV + JSON files.
"""
from __future__ import annotations

import csv
import json
import random
from pathlib import Path

random.seed(42)

DATA_DIR = Path(__file__).parent

BUSINESS_UNITS = ["Electronics", "Automotive", "Healthcare"]
REGIONS = ["APAC", "EMEA", "Americas"]
YEARS = [2023, 2024, 2025]

ACCOUNTS = [
    ("4000", "Product Revenue",        "Revenue"),
    ("4100", "Service Revenue",        "Revenue"),
    ("5000", "Cost of Goods Sold",     "COGS"),
    ("6100", "Salaries & Wages",       "Opex"),
    ("6200", "Marketing",              "Opex"),
    ("6300", "R&D",                    "Opex"),
    ("6400", "Travel",                 "Opex"),
    ("6500", "IT & Infrastructure",    "Opex"),
    ("6600", "General & Admin",        "Opex"),
    ("7100", "Depreciation",           "D&A"),
    ("8100", "Interest Expense",       "Finance"),
    ("9100", "Income Tax",             "Tax"),
]

# Scale factors per BU (in millions of USD, annualised)
BU_SCALE = {"Electronics": 1.0, "Automotive": 1.4, "Healthcare": 0.7}
REGION_SCALE = {"APAC": 0.9, "EMEA": 1.0, "Americas": 1.2}


def month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def quarter_of(month: int) -> str:
    return f"Q{(month - 1) // 3 + 1}"


def base_amount(category: str) -> float:
    """Monthly base amount in USD (millions) for a category at scale 1.0.

    Tuned so a scale-1.0 BU/region has ~15% EBIT margin at the group level.
    """
    return {
        "Revenue":  40.0,     # total across product + service
        "COGS":    -22.0,     # 55% of revenue (manufacturing-like)
        "Opex":     -8.0,     # 20% of revenue (split across 6 Opex accounts)
        "D&A":      -2.0,     # 5% of revenue
        "Finance":  -1.2,
        "Tax":      -2.5,
    }[category]


def generate_actuals_and_budget():
    actuals_rows, budget_rows = [], []
    for year in YEARS:
        for month in range(1, 13):
            # 2025 only goes to Q3 (Sep) to mimic YTD data
            if year == 2025 and month > 9:
                continue
            for bu in BUSINESS_UNITS:
                for region in REGIONS:
                    for code, name, category in ACCOUNTS:
                        scale = BU_SCALE[bu] * REGION_SCALE[region]
                        base = base_amount(category) * scale
                        # Revenue accounts: split 70/30 between product/service
                        if code == "4000":
                            base *= 0.70
                        elif code == "4100":
                            base *= 0.30
                        # Opex split across 6 Opex accounts
                        elif category == "Opex":
                            opex_split = {
                                "6100": 0.40, "6200": 0.15, "6300": 0.20,
                                "6400": 0.05, "6500": 0.12, "6600": 0.08,
                            }
                            base = base_amount("Opex") * scale * opex_split[code]

                        # Year-over-year growth, slight seasonality
                        yoy = 1.0 + (year - 2023) * 0.06
                        seasonality = 1.0 + 0.08 * ((month - 6) / 6.0)
                        budget_amount = base * yoy * seasonality

                        # Actuals deviate from budget
                        variance_pct = random.uniform(-0.08, 0.10)
                        actual_amount = budget_amount * (1 + variance_pct)

                        period = month_key(year, month)
                        qtr = quarter_of(month)
                        row_common = {
                            "period": period,
                            "fiscal_year": f"FY{year}",
                            "fiscal_quarter": qtr,
                            "bu": bu,
                            "region": region,
                            "account_code": code,
                            "account_name": name,
                            "account_category": category,
                        }
                        actuals_rows.append({**row_common, "amount_usd_mn": round(actual_amount, 3), "source": "SAP-ECC"})
                        budget_rows.append({**row_common, "amount_usd_mn": round(budget_amount, 3), "source": "SAP-BPC"})

    _write_csv(DATA_DIR / "sap_gl_actuals.csv", actuals_rows)
    _write_csv(DATA_DIR / "sap_gl_budget.csv",  budget_rows)


def generate_hfm_consolidated():
    """HFM consolidated view — group-level roll-up (no region split)."""
    rows = []
    for year in YEARS:
        for month in range(1, 13):
            if year == 2025 and month > 9:
                continue
            for bu in BUSINESS_UNITS:
                for code, name, category in ACCOUNTS:
                    scale = BU_SCALE[bu] * sum(REGION_SCALE.values())
                    base = base_amount(category) * scale
                    if code == "4000": base *= 0.70
                    elif code == "4100": base *= 0.30
                    elif category == "Opex":
                        opex_split = {"6100":0.40,"6200":0.15,"6300":0.20,"6400":0.05,"6500":0.12,"6600":0.08}
                        base = base_amount("Opex") * scale * opex_split[code]
                    yoy = 1.0 + (year - 2023) * 0.06
                    seasonality = 1.0 + 0.08 * ((month - 6) / 6.0)
                    amt = base * yoy * seasonality * (1 + random.uniform(-0.04, 0.04))
                    rows.append({
                        "period": month_key(year, month),
                        "fiscal_year": f"FY{year}",
                        "fiscal_quarter": quarter_of(month),
                        "entity": f"GRP-{bu[:4].upper()}",
                        "bu": bu,
                        "account_code": code,
                        "account_name": name,
                        "account_category": category,
                        "amount_usd_mn": round(amt, 3),
                        "source": "HFM",
                    })
    _write_csv(DATA_DIR / "hfm_consolidated.csv", rows)


def generate_projects():
    """Strategic projects with multi-year ROI."""
    projects = [
        ("Project Orion",    "Electronics", "APAC",     "Active"),
        ("Project Atlas",    "Electronics", "EMEA",     "Active"),
        ("Project Nova",     "Automotive",  "Americas", "Active"),
        ("Project Helios",   "Automotive",  "EMEA",     "Closed"),
        ("Project Vega",     "Healthcare",  "APAC",     "Active"),
        ("Project Pulsar",   "Healthcare",  "Americas", "On Hold"),
    ]
    rows = []
    for pname, bu, region, status in projects:
        base_invest = random.uniform(20, 80)
        for year in [2023, 2024, 2025]:
            invest = base_invest * random.uniform(0.9, 1.2) * (1 + (year - 2023) * 0.15)
            # Orion is an improving project
            if pname == "Project Orion":
                roi = 0.08 + (year - 2023) * 0.05 + random.uniform(-0.01, 0.01)
            else:
                roi = random.uniform(0.03, 0.18)
            returns = invest * (1 + roi)
            rows.append({
                "project_name": pname,
                "bu": bu,
                "region": region,
                "fiscal_year": f"FY{year}",
                "status": status,
                "investment_usd_mn": round(invest, 2),
                "returns_usd_mn":    round(returns, 2),
                "roi_pct":           round(roi * 100, 2),
                "source": "PPM-System",
            })
    _write_csv(DATA_DIR / "projects_roi.csv", rows)


def generate_users():
    users = [
        {"user_id": "u001", "name": "Sarah Chen",       "email": "sarah.chen@corp.com",
         "role": "Group CFO",         "bu_scope": "*", "region_scope": "*"},
        {"user_id": "u002", "name": "Marcus Weber",     "email": "marcus.weber@corp.com",
         "role": "BU General Manager", "bu_scope": "Electronics", "region_scope": "*"},
        {"user_id": "u003", "name": "Priya Iyer",       "email": "priya.iyer@corp.com",
         "role": "Regional Finance BP", "bu_scope": "*", "region_scope": "APAC"},
        {"user_id": "u004", "name": "Diego Alvarez",    "email": "diego.alvarez@corp.com",
         "role": "BU Finance BP",     "bu_scope": "Automotive", "region_scope": "Americas"},
        {"user_id": "u005", "name": "Yuki Tanaka",      "email": "yuki.tanaka@corp.com",
         "role": "Analyst",           "bu_scope": "Healthcare", "region_scope": "APAC"},
    ]
    (DATA_DIR / "users.json").write_text(json.dumps(users, indent=2))


def _write_csv(path: Path, rows: list[dict]):
    if not rows:
        return
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows):>6,} rows → {path.name}")


if __name__ == "__main__":
    generate_actuals_and_budget()
    generate_hfm_consolidated()
    generate_projects()
    generate_users()
    print("done.")
