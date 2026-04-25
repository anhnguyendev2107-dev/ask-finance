export interface GlossaryEntry {
  definition: string;
  formula: string;
  categories: string[];
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  Revenue: {
    definition: "Total income from sales of products and services, before any costs.",
    formula: "Revenue = Product Revenue + Service Revenue",
    categories: ["Revenue"],
  },
  COGS: {
    definition: "Cost of Goods Sold — direct costs attributable to producing goods sold.",
    formula: "Sum of 'COGS' category accounts (sign convention: negative).",
    categories: ["COGS"],
  },
  "Gross Profit": {
    definition: "Revenue minus COGS. Measures production efficiency.",
    formula: "Gross Profit = Revenue − COGS",
    categories: ["Revenue", "COGS"],
  },
  "Gross Margin": {
    definition: "Gross profit as a percentage of revenue.",
    formula: "Gross Margin = Gross Profit / Revenue",
    categories: ["Revenue", "COGS"],
  },
  Opex: {
    definition: "Operating expenses — overhead to run the business, excluding COGS.",
    formula: "Sum of 'Opex' category accounts.",
    categories: ["Opex"],
  },
  EBITDA: {
    definition: "Earnings Before Interest, Tax, Depreciation, Amortisation.",
    formula: "EBITDA = Revenue − COGS − Opex",
    categories: ["Revenue", "COGS", "Opex"],
  },
  EBIT: {
    definition: "Earnings Before Interest and Tax (operating profit).",
    formula: "EBIT = EBITDA − D&A = Revenue − COGS − Opex − D&A",
    categories: ["Revenue", "COGS", "Opex", "D&A"],
  },
  "EBIT Margin": {
    definition: "EBIT as a percentage of revenue; a core profitability measure.",
    formula: "EBIT Margin = EBIT / Revenue",
    categories: ["Revenue", "COGS", "Opex", "D&A"],
  },
  "Net Income": {
    definition: "Profit after all costs, interest and tax.",
    formula: "Net Income = EBIT − Interest − Tax",
    categories: ["Revenue", "COGS", "Opex", "D&A", "Finance", "Tax"],
  },
  Variance: {
    definition: "Difference between actual and budgeted amounts.",
    formula: "Variance $ = Actual − Budget;  Variance % = (Actual − Budget) / |Budget|",
    categories: [],
  },
  ROI: {
    definition: "Return on Investment — profitability of a project or investment.",
    formula: "ROI = (Returns − Investment) / Investment",
    categories: [],
  },
  "P&L": {
    definition: "Profit & Loss statement — the full income statement from Revenue to Net Income.",
    formula: "Revenue → Gross Profit → EBITDA → EBIT → Net Income",
    categories: ["Revenue", "COGS", "Opex", "D&A", "Finance", "Tax"],
  },
  "Cash Flow": {
    definition: "Movement of cash in/out of the business over a period.",
    formula: "Operating CF + Investing CF + Financing CF (not modeled in this prototype).",
    categories: [],
  },
};

const ALIASES: Record<string, string> = {
  opex: "Opex",
  "operating expenses": "Opex",
  cogs: "COGS",
  "cost of goods sold": "COGS",
  ebit: "EBIT",
  ebitda: "EBITDA",
  "ebit margin": "EBIT Margin",
  "operating margin": "EBIT Margin",
  "gross margin": "Gross Margin",
  "gross profit": "Gross Profit",
  roi: "ROI",
  "return on investment": "ROI",
  "p&l": "P&L",
  pl: "P&L",
  "profit and loss": "P&L",
  "net income": "Net Income",
  "net profit": "Net Income",
  revenue: "Revenue",
  sales: "Revenue",
  variance: "Variance",
  "cash flow": "Cash Flow",
};

export function lookupGlossary(term: string): (GlossaryEntry & { term: string }) | null {
  const key = ALIASES[term.trim().toLowerCase()] ?? term;
  const hit = GLOSSARY[key];
  return hit ? { term: key, ...hit } : null;
}
