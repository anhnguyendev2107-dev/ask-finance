import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";
import { filterByScope, require_ } from "./rbac";
import type { ActualsRow, BudgetRow, ProjectRow, RBACContext } from "./types";

const DATA_DIR = path.join(process.cwd(), "lib", "data");

function readCsv<T>(file: string, numericFields: string[]): T[] {
  const text = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
  return parseCsv<Record<string, string | number>>(text, numericFields) as T[];
}

let _actuals: ActualsRow[] | null = null;
let _budget: BudgetRow[] | null = null;
let _projects: ProjectRow[] | null = null;

function actuals(): ActualsRow[] {
  return (_actuals ??= readCsv<ActualsRow>("sap_gl_actuals.csv", ["amount_usd_mn"]));
}
function budget(): BudgetRow[] {
  return (_budget ??= readCsv<BudgetRow>("sap_gl_budget.csv", ["amount_usd_mn"]));
}
function projects(): ProjectRow[] {
  return (_projects ??= readCsv<ProjectRow>("projects_roi.csv", [
    "investment_usd_mn",
    "returns_usd_mn",
    "roi_pct",
  ]));
}

export function actualsFor(ctx: RBACContext): ActualsRow[] {
  require_(ctx, "read_actuals");
  return filterByScope(ctx, actuals());
}

export function budgetFor(ctx: RBACContext): BudgetRow[] {
  require_(ctx, "read_budget");
  return filterByScope(ctx, budget());
}

export function projectsFor(ctx: RBACContext): ProjectRow[] {
  require_(ctx, "read_projects");
  return filterByScope(ctx, projects());
}

export function dataCatalog(ctx: RBACContext) {
  const a = actualsFor(ctx);
  const p = ctx.capabilities.read_projects ? projectsFor(ctx) : [];
  return {
    actuals: {
      rows: a.length,
      periods: uniqueSorted(a.map((r) => r.period)),
      business_units: uniqueSorted(a.map((r) => r.bu)),
      regions: uniqueSorted(a.map((r) => r.region)),
      account_categories: uniqueSorted(a.map((r) => r.account_category)),
    },
    projects: {
      rows: p.length,
      projects: uniqueSorted(p.map((r) => r.project_name)),
    },
    budget_access: ctx.capabilities.read_budget,
  };
}

function uniqueSorted<T>(xs: T[]): T[] {
  return Array.from(new Set(xs)).sort() as T[];
}
