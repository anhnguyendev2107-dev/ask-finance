import { actualsFor, budgetFor, dataCatalog, projectsFor } from "./data-loader";
import { GLOSSARY, lookupGlossary } from "./glossary";
import { can, PermissionDeniedError, scopeDescription } from "./rbac";
import type { ActualsRow, Citation, RBACContext } from "./types";

interface ScopeFilters {
  bu?: string;
  region?: string;
  fiscal_year?: string;
  fiscal_quarter?: string;
  period?: string;
  account_category?: string;
}

function applyFilters<T extends Partial<ActualsRow>>(rows: T[], f: ScopeFilters): T[] {
  return rows.filter((r) => {
    if (f.bu && r.bu !== f.bu) return false;
    if (f.region && r.region !== undefined && r.region !== f.region) return false;
    if (f.fiscal_year && r.fiscal_year !== f.fiscal_year) return false;
    if (f.fiscal_quarter && r.fiscal_quarter !== f.fiscal_quarter) return false;
    if (f.period && r.period !== f.period) return false;
    if (f.account_category && r.account_category !== f.account_category) return false;
    return true;
  });
}

function describeFilters(f: Record<string, unknown> | object): string {
  const active = Object.entries(f as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`);
  return active.length ? active.join(", ") : "no filters";
}

function sumByCategory(rows: ActualsRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.account_category] = (out[r.account_category] ?? 0) + r.amount_usd_mn;
  }
  for (const k of Object.keys(out)) out[k] = round(out[k], 3);
  return out;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function pct(n: number, d: number): number | null {
  return d ? round((n / d) * 100, 2) : null;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
export function toolGetPnlSummary(
  ctx: RBACContext,
  args: ScopeFilters,
): Record<string, unknown> {
  const rows = actualsFor(ctx);
  const filtered = applyFilters(rows, args);
  const cats = sumByCategory(filtered);

  const revenue = cats.Revenue ?? 0;
  const cogs = cats.COGS ?? 0;
  const opex = cats.Opex ?? 0;
  const da = cats["D&A"] ?? 0;
  const finance = cats.Finance ?? 0;
  const tax = cats.Tax ?? 0;

  const grossProfit = revenue + cogs;
  const ebitda = revenue + cogs + opex;
  const ebit = ebitda + da;
  const netIncome = ebit + finance + tax;

  return {
    scope: scopeDescription(ctx),
    filters_applied: args,
    currency: "USD millions",
    by_category: cats,
    metrics: {
      Revenue: round(revenue, 3),
      "Gross Profit": round(grossProfit, 3),
      "Gross Margin %": pct(grossProfit, revenue),
      EBITDA: round(ebitda, 3),
      EBIT: round(ebit, 3),
      "EBIT Margin %": pct(ebit, revenue),
      "Net Income": round(netIncome, 3),
      "Net Margin %": pct(netIncome, revenue),
    },
    citations: [
      {
        source: "SAP-ECC (sap_gl_actuals.csv)",
        filters: describeFilters(args),
        rows: filtered.length,
      } satisfies Citation,
    ],
  };
}

export function toolGetVariance(
  ctx: RBACContext,
  args: ScopeFilters,
): Record<string, unknown> {
  if (!can(ctx, "read_budget")) {
    return { error: "Your role does not have budget data access.", role: ctx.role };
  }
  const actRows = actualsFor(ctx);
  const budRows = budgetFor(ctx);
  const act = applyFilters(actRows, args);
  const bud = applyFilters(budRows, args);

  const actual = round(act.reduce((s, r) => s + r.amount_usd_mn, 0), 3);
  const budget = round(bud.reduce((s, r) => s + r.amount_usd_mn, 0), 3);
  const variance = round(actual - budget, 3);
  const variancePct = budget ? round((variance / Math.abs(budget)) * 100, 2) : null;

  let interpretation: string | null = null;
  const cat = args.account_category;
  if (cat && ["COGS", "Opex", "D&A", "Finance", "Tax"].includes(cat)) {
    interpretation = variance > 0 ? "Favourable" : "Unfavourable";
  } else if (cat === "Revenue") {
    interpretation = variance > 0 ? "Favourable" : "Unfavourable";
  }

  return {
    scope: scopeDescription(ctx),
    filters_applied: args,
    currency: "USD millions",
    actual,
    budget,
    variance,
    variance_pct: variancePct,
    interpretation,
    citations: [
      { source: "SAP-ECC (sap_gl_actuals.csv)", filters: describeFilters(args), rows: act.length },
      { source: "SAP-BPC (sap_gl_budget.csv)", filters: describeFilters(args), rows: bud.length },
    ] satisfies Citation[],
  };
}

export function toolGetMetricTrend(
  ctx: RBACContext,
  args: {
    metric: string;
    bu?: string;
    region?: string;
    fiscal_years?: string[];
    granularity?: "year" | "quarter";
  },
): Record<string, unknown> {
  let df = actualsFor(ctx);
  if (args.bu) df = df.filter((r) => r.bu === args.bu);
  if (args.region) df = df.filter((r) => r.region === args.region);
  if (args.fiscal_years?.length) df = df.filter((r) => args.fiscal_years!.includes(r.fiscal_year));

  const granularity = args.granularity ?? "year";
  const groupCol: keyof ActualsRow = granularity === "year" ? "fiscal_year" : "period";
  const buckets = new Map<string, ActualsRow[]>();
  for (const r of df) {
    const key = r[groupCol] as string;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const points: { [k: string]: string | number | null }[] = [];
  for (const [key, group] of buckets) {
    const cats = sumByCategory(group);
    const rev = cats.Revenue ?? 0;
    const cogs = cats.COGS ?? 0;
    const opex = cats.Opex ?? 0;
    const da = cats["D&A"] ?? 0;
    const gp = rev + cogs;
    const ebit = rev + cogs + opex + da;
    const valueMap: Record<string, number | null> = {
      Revenue: rev,
      "Gross Profit": gp,
      EBIT: ebit,
      "EBIT Margin %": rev ? round((ebit / rev) * 100, 2) : null,
      "Net Income": ebit + (cats.Finance ?? 0) + (cats.Tax ?? 0),
    };
    const v = valueMap[args.metric];
    points.push({ [groupCol]: key, value: v == null ? null : round(v, 3) });
  }
  points.sort((a, b) => String(a[groupCol]).localeCompare(String(b[groupCol])));

  return {
    metric: args.metric,
    granularity,
    scope: scopeDescription(ctx),
    filters_applied: { bu: args.bu, region: args.region, fiscal_years: args.fiscal_years },
    series: points,
    citations: [
      {
        source: "SAP-ECC (sap_gl_actuals.csv)",
        filters: describeFilters({
          bu: args.bu,
          region: args.region,
          fiscal_years: args.fiscal_years?.join(","),
        }),
        rows: df.length,
      } satisfies Citation,
    ],
  };
}

export function toolGetProjectRoi(
  ctx: RBACContext,
  args: { project_name?: string; fiscal_years?: string[] },
): Record<string, unknown> {
  let df = projectsFor(ctx);
  if (args.project_name) {
    const target = args.project_name.toLowerCase();
    df = df.filter((r) => r.project_name.toLowerCase() === target);
  }
  if (args.fiscal_years?.length) {
    df = df.filter((r) => args.fiscal_years!.includes(r.fiscal_year));
  }
  if (df.length === 0) {
    return {
      error: "No project data in your scope matches.",
      scope: scopeDescription(ctx),
      requested: args,
    };
  }
  return {
    scope: scopeDescription(ctx),
    records: df,
    citations: [
      {
        source: "PPM-System (projects_roi.csv)",
        filters: `project=${args.project_name ?? "*"}`,
        rows: df.length,
      } satisfies Citation,
    ],
  };
}

export function toolLookupGlossary(
  _ctx: RBACContext,
  args: { term: string },
): Record<string, unknown> {
  const hit = lookupGlossary(args.term);
  if (!hit) {
    return { term: args.term, found: false, available_terms: Object.keys(GLOSSARY).sort() };
  }
  return {
    term: hit.term,
    found: true,
    definition: hit.definition,
    formula: hit.formula,
    categories: hit.categories,
    citations: [
      { source: "Internal Finance Glossary", filters: `term=${args.term}`, rows: 1 } satisfies Citation,
    ],
  };
}

export function toolDescribeDataScope(ctx: RBACContext): Record<string, unknown> {
  return {
    user: { name: ctx.name, role: ctx.role, scope: scopeDescription(ctx) },
    capabilities: ctx.capabilities,
    catalog: dataCatalog(ctx),
  };
}

// ---------------------------------------------------------------------------
// Tool registry — Anthropic tool-use schemas
// ---------------------------------------------------------------------------
export const TOOL_SCHEMAS = [
  {
    name: "describe_data_scope",
    description:
      "List what data the current user has access to (BUs, regions, years, projects, capabilities). Call this FIRST if unsure what is visible to the user.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "lookup_glossary",
    description:
      "Look up the definition and formula for a finance term (e.g., EBIT, Opex, ROI, variance). Call this when the user asks about a concept, or when you need the formula before computing.",
    input_schema: {
      type: "object",
      properties: { term: { type: "string", description: "Finance term to look up." } },
      required: ["term"],
    },
  },
  {
    name: "get_pnl_summary",
    description:
      "Get aggregated P&L for a scope (revenue, gross profit, EBITDA, EBIT, net income). Amounts are USD millions. Filters optional; omit to aggregate over the whole visible dataset.",
    input_schema: {
      type: "object",
      properties: {
        bu: { type: "string", description: "Business unit, e.g. 'Electronics'." },
        region: { type: "string", description: "Region, e.g. 'APAC'." },
        fiscal_year: { type: "string", description: "e.g. 'FY2024'." },
        fiscal_quarter: { type: "string", description: "'Q1' | 'Q2' | 'Q3' | 'Q4'." },
        period: { type: "string", description: "Month in YYYY-MM format." },
      },
      required: [],
    },
  },
  {
    name: "get_variance",
    description:
      "Actual vs Budget variance for a scope and optional account category. Requires budget read permission.",
    input_schema: {
      type: "object",
      properties: {
        bu: { type: "string" },
        region: { type: "string" },
        fiscal_year: { type: "string" },
        fiscal_quarter: { type: "string" },
        account_category: {
          type: "string",
          enum: ["Revenue", "COGS", "Opex", "D&A", "Finance", "Tax"],
        },
      },
      required: [],
    },
  },
  {
    name: "get_metric_trend",
    description: "Time-series trend of a single metric across years or quarters.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["Revenue", "Gross Profit", "EBIT", "EBIT Margin %", "Net Income"],
        },
        bu: { type: "string" },
        region: { type: "string" },
        fiscal_years: { type: "array", items: { type: "string" } },
        granularity: { type: "string", enum: ["year", "quarter"], default: "year" },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_project_roi",
    description:
      "Get ROI data for a project (e.g. 'Project Orion') across fiscal years, or for all visible projects.",
    input_schema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        fiscal_years: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
] as const;

type ToolFn = (ctx: RBACContext, args: Record<string, unknown>) => Record<string, unknown>;

export const TOOL_DISPATCH: Record<string, ToolFn> = {
  describe_data_scope: (ctx) => toolDescribeDataScope(ctx),
  lookup_glossary: (ctx, a) => toolLookupGlossary(ctx, a as { term: string }),
  get_pnl_summary: (ctx, a) => toolGetPnlSummary(ctx, a as ScopeFilters),
  get_variance: (ctx, a) => toolGetVariance(ctx, a as ScopeFilters),
  get_metric_trend: (ctx, a) =>
    toolGetMetricTrend(
      ctx,
      a as Parameters<typeof toolGetMetricTrend>[1],
    ),
  get_project_roi: (ctx, a) =>
    toolGetProjectRoi(ctx, a as Parameters<typeof toolGetProjectRoi>[1]),
};

export function runTool(
  name: string,
  ctx: RBACContext,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const fn = TOOL_DISPATCH[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return fn(ctx, args ?? {});
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { error: "permission_denied", message: err.message };
    }
    return {
      error: err instanceof Error ? err.constructor.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
