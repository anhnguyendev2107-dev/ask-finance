export type RoleName =
  | "Group CFO"
  | "BU General Manager"
  | "Regional Finance BP"
  | "BU Finance BP"
  | "Analyst";

export type Capability = "read_actuals" | "read_budget" | "read_projects" | "export";

export interface User {
  user_id: string;
  name: string;
  email: string;
  role: RoleName;
  bu_scope: string;
  region_scope: string;
}

export interface RBACContext extends User {
  capabilities: Record<Capability, boolean>;
}

export interface ActualsRow {
  period: string;
  fiscal_year: string;
  fiscal_quarter: string;
  bu: string;
  region: string;
  account_code: string;
  account_name: string;
  account_category: string;
  amount_usd_mn: number;
  source: string;
}

export type BudgetRow = ActualsRow;

export interface ProjectRow {
  project_name: string;
  bu: string;
  region: string;
  fiscal_year: string;
  status: string;
  investment_usd_mn: number;
  returns_usd_mn: number;
  roi_pct: number;
  source: string;
}

/**
 * HFM consolidated rows — group-level, post-elimination, per legal entity.
 * Note: no `region` column. Group consolidation is rolled up by entity / BU only.
 */
export interface HfmRow {
  period: string;
  fiscal_year: string;
  fiscal_quarter: string;
  entity: string;
  bu: string;
  account_code: string;
  account_name: string;
  account_category: string;
  amount_usd_mn: number;
  source: string;
}

export interface Citation {
  source: string;
  filters: string;
  rows: number;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface AgentTrace {
  user_query: string;
  user_id: string;
  iterations: number;
  tool_calls: ToolCall[];
  final_text: string;
  error: string | null;
  provider: "gemini" | "mock";
  /** Pool indices of API keys that served this run (Gemini provider only). */
  keys_used?: number[];
}
