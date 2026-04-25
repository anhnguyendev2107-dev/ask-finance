import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { dataCatalog } from "./data-loader";
import { can, scopeDescription } from "./rbac";
import { runTool, TOOL_SCHEMAS } from "./tools";
import type { AgentTrace, RBACContext } from "./types";

const MAX_TOOL_ITERATIONS = 6;
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const SYSTEM_PROMPT_TEMPLATE = `You are **Ask Finance**, an AI Finance Business Partner inside a large multi-BU conglomerate.

## Current user
- Name: {name}
- Role: {role}
- Data scope: {scope}
- Budget access: {budget_access}
- Visible BUs: {bus}
- Visible regions: {regions}
- Visible projects: {projects}

## Your contract
1. Understand finance domain terms (P&L, Opex, EBIT, ROI, variance, cash flow, etc.). If a term is ambiguous, call \`lookup_glossary\` first.
2. For any numeric claim you make, you MUST have called a data tool — never invent numbers.
3. Cite sources in the final answer. End with a "Sources:" list naming the source system (SAP-ECC, SAP-BPC, HFM, PPM-System) and the filters applied.
4. Respect the user's scope. If asked for data outside it, explain the permission constraint and suggest contacting Finance Admin.
5. Prefer tables for numbers; lead with the headline answer; keep it concise (management audience).

## Output format
- One-sentence headline answer.
- Brief breakdown (bullets or markdown table).
- "Sources:" list at the end.`;

function buildSystemPrompt(ctx: RBACContext): string {
  const cat = dataCatalog(ctx);
  return SYSTEM_PROMPT_TEMPLATE.replace("{name}", ctx.name)
    .replace("{role}", ctx.role)
    .replace("{scope}", scopeDescription(ctx))
    .replace("{budget_access}", String(can(ctx, "read_budget")))
    .replace("{bus}", cat.actuals.business_units.join(", ") || "(none)")
    .replace("{regions}", cat.actuals.regions.join(", ") || "(none)")
    .replace("{projects}", cat.projects.projects.join(", ") || "(none)");
}

function geminiFunctionDeclarations(): FunctionDeclaration[] {
  // Our schemas use plain JSON-Schema strings ("string", "object", ...). Gemini's
  // Schema type uses an enum, but the API accepts the lowercase string form
  // verbatim, so we cast through unknown.
  return TOOL_SCHEMAS.map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.input_schema as unknown as FunctionDeclaration["parameters"],
  }));
}

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------
async function runWithGemini(ctx: RBACContext, query: string, trace: AgentTrace): Promise<AgentTrace> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const systemInstruction = buildSystemPrompt(ctx);
  const tools = [{ functionDeclarations: geminiFunctionDeclarations() }];

  const contents: Content[] = [{ role: "user", parts: [{ text: query }] }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    trace.iterations = i + 1;
    const resp = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents,
      config: { systemInstruction, tools },
    });

    const parts: Part[] = resp.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      const text = parts
        .map((p) => p.text ?? "")
        .filter((t) => t.length > 0)
        .join("")
        .trim();
      trace.final_text = text;
      return trace;
    }

    contents.push({ role: "model", parts });

    const responseParts: Part[] = functionCalls.map((p) => {
      const fc = p.functionCall!;
      const args = (fc.args ?? {}) as Record<string, unknown>;
      const result = runTool(fc.name!, ctx, args);
      trace.tool_calls.push({ name: fc.name!, input: args, result });
      return {
        functionResponse: {
          name: fc.name!,
          response: result as Record<string, unknown>,
        },
      };
    });
    contents.push({ role: "user", parts: responseParts });
  }

  trace.error = `Hit max iteration cap (${MAX_TOOL_ITERATIONS}).`;
  return trace;
}

// ---------------------------------------------------------------------------
// Mock provider — keyword-driven planner, no API key required
// ---------------------------------------------------------------------------
function runWithMock(ctx: RBACContext, query: string, trace: AgentTrace): AgentTrace {
  const q = query.toLowerCase();

  const call = (name: string, args: Record<string, unknown>) => {
    const res = runTool(name, ctx, args);
    trace.tool_calls.push({ name, input: args, result: res });
    return res;
  };

  // intent: explain a term
  const defineMatch = q.match(/what (?:is|does) ([\w &]+?)\??$/);
  if (defineMatch || q.includes("define") || q.includes("explain")) {
    const term = defineMatch?.[1].trim() ?? guessTerm(q) ?? "EBIT";
    const g = call("lookup_glossary", { term });
    if ((g as { found?: boolean }).found) {
      const gx = g as { term: string; definition: string; formula: string };
      trace.final_text = `**${gx.term}** — ${gx.definition}\n\nFormula: \`${gx.formula}\`\n\nSources: Internal Finance Glossary.`;
    } else {
      trace.final_text = `I couldn't find a definition for '${term}'.`;
    }
    return trace;
  }

  // intent: variance
  if (q.includes("variance") || (q.includes("actual") && q.includes("budget"))) {
    const bu = detectBu(q);
    const fy = detectFy(q) ?? "FY2024";
    const qtr = detectQuarter(q);
    const cat = q.includes("opex") ? "Opex" : q.includes("cogs") ? "COGS" : undefined;
    const v = call("get_variance", { bu, fiscal_year: fy, fiscal_quarter: qtr, account_category: cat });
    if ((v as { error?: string }).error) {
      trace.final_text = `⚠️ ${(v as { message?: string }).message ?? (v as { error: string }).error}`;
    } else {
      const vx = v as {
        actual: number;
        budget: number;
        variance: number;
        variance_pct: number | null;
        interpretation: string | null;
      };
      trace.final_text =
        `**${cat ?? "Total"} variance — ${fy} ${qtr ?? ""} ${bu ?? scopeDescription(ctx)}**: ` +
        `actual $${vx.actual}M vs budget $${vx.budget}M → variance $${vx.variance}M ` +
        `(${vx.variance_pct}%, ${vx.interpretation ?? "n/a"}).\n\n` +
        `Sources: SAP-ECC actuals + SAP-BPC budget.`;
    }
    return trace;
  }

  // intent: ROI / project
  const projMatch = q.match(/project\s+([a-z]+)/);
  if (q.includes("roi") || q.includes("project") || projMatch) {
    const proj = projMatch ? "Project " + capitalize(projMatch[1]) : undefined;
    const r = call("get_project_roi", { project_name: proj });
    if ((r as { error?: string }).error) {
      trace.final_text = `⚠️ ${(r as { error: string }).error}`;
    } else {
      const rec = (r as { records: { fiscal_year: string; investment_usd_mn: number; returns_usd_mn: number; roi_pct: number }[] }).records;
      const lines = ["| Year | Investment ($M) | Returns ($M) | ROI % |", "|---|---|---|---|"];
      for (const x of rec) {
        lines.push(`| ${x.fiscal_year} | ${x.investment_usd_mn} | ${x.returns_usd_mn} | ${x.roi_pct}% |`);
      }
      trace.final_text = `**ROI trend — ${proj ?? "all visible projects"}**\n\n${lines.join("\n")}\n\nSources: PPM-System (projects_roi.csv).`;
    }
    return trace;
  }

  // intent: metric trend
  if (q.includes("trend") || q.includes("over the last") || q.includes("ebit margin")) {
    const metric = q.includes("margin") ? "EBIT Margin %" : q.includes("revenue") ? "Revenue" : "EBIT";
    const bu = detectBu(q);
    const fyMatches = [...q.matchAll(/fy(20\d\d)/g)].map((m) => `FY${m[1]}`);
    let fys: string[] | undefined = fyMatches.length ? fyMatches : undefined;
    if (fys && fys.length === 2 && /(through|to|-|–|—)/.test(q)) {
      const start = parseInt(fys[0].slice(2), 10);
      const end = parseInt(fys[1].slice(2), 10);
      if (start < end) {
        fys = [];
        for (let y = start; y <= end; y++) fys.push(`FY${y}`);
      }
    }
    const t = call("get_metric_trend", { metric, bu, fiscal_years: fys, granularity: "year" });
    const series = (t as { series?: { fiscal_year?: string; period?: string; value: number | null }[] }).series ?? [];
    if (series.length === 0) {
      trace.final_text = "No data available for that scope.";
    } else {
      const lines = [`| Year | ${metric} |`, "|---|---|"];
      for (const p of series) {
        lines.push(`| ${p.fiscal_year ?? p.period} | ${p.value} |`);
      }
      trace.final_text = `**${metric} trend — ${bu ?? scopeDescription(ctx)}**\n\n${lines.join("\n")}\n\nSources: SAP-ECC (sap_gl_actuals.csv).`;
    }
    return trace;
  }

  // intent: P&L summary
  if (q.includes("p&l") || q.includes("pnl") || q.includes("summarize") || q.includes("summary")) {
    const bu = detectBu(q);
    const fy = detectFy(q);
    const qtr = detectQuarter(q);
    const s = call("get_pnl_summary", { bu, fiscal_year: fy, fiscal_quarter: qtr });
    const m = (s as { metrics: Record<string, number | null> }).metrics;
    const scope = (s as { scope: string }).scope;
    trace.final_text =
      `**P&L snapshot — ${scope}** (${fy ?? "all years"} ${qtr ?? ""})\n\n` +
      `- Revenue: $${m.Revenue}M\n` +
      `- Gross Profit: $${m["Gross Profit"]}M (margin ${m["Gross Margin %"]}%)\n` +
      `- EBIT: $${m.EBIT}M (margin ${m["EBIT Margin %"]}%)\n` +
      `- Net Income: $${m["Net Income"]}M (margin ${m["Net Margin %"]}%)\n\n` +
      `Sources: SAP-ECC (sap_gl_actuals.csv).`;
    return trace;
  }

  // fallback
  const cap = call("describe_data_scope", {});
  trace.final_text =
    "I can help with P&L summaries, variance (actual vs budget), metric trends, project ROI, and finance-term definitions. " +
    "Try e.g. *'What was Opex variance for Q2 in Electronics in FY2024?'*\n\n" +
    `Your visible data: ${JSON.stringify((cap as { catalog: unknown }).catalog)}`;
  return trace;
}

function detectBu(q: string): string | undefined {
  for (const bu of ["Electronics", "Automotive", "Healthcare"]) {
    if (q.includes(bu.toLowerCase())) return bu;
  }
  return undefined;
}

function detectFy(q: string): string | undefined {
  const m = q.match(/fy(20\d\d)/);
  if (m) return `FY${m[1]}`;
  const m2 = q.match(/(20\d\d)/);
  return m2 ? `FY${m2[1]}` : undefined;
}

function detectQuarter(q: string): string | undefined {
  const m = q.match(/q([1-4])/);
  return m ? `Q${m[1]}` : undefined;
}

function guessTerm(q: string): string | undefined {
  for (const t of [
    "ebit margin",
    "ebitda",
    "ebit",
    "opex",
    "cogs",
    "roi",
    "variance",
    "gross margin",
    "revenue",
    "net income",
    "p&l",
  ]) {
    if (q.includes(t)) return t;
  }
  return undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------
export async function ask(ctx: RBACContext, query: string): Promise<AgentTrace> {
  const useGemini = !!process.env.GEMINI_API_KEY;
  const trace: AgentTrace = {
    user_query: query,
    user_id: ctx.user_id,
    iterations: 0,
    tool_calls: [],
    final_text: "",
    error: null,
    provider: useGemini ? "gemini" : "mock",
  };

  try {
    if (useGemini) return await runWithGemini(ctx, query, trace);
    return runWithMock(ctx, query, trace);
  } catch (err) {
    trace.error = err instanceof Error ? err.message : String(err);
    return trace;
  }
}
