"use client";

import dynamic from "next/dynamic";
import type { ChartSpec as ImplSpec } from "./ChartImpl";

export type ChartSpec = ImplSpec;

// Recharts ships ~95KB gzipped + d3 deps. Lazy-load it so the chat page stays
// lean — the bundle only arrives once an answer actually contains a chart.
const ChartImpl = dynamic(() => import("./ChartImpl"), {
  ssr: false,
  loading: () => <div className="chart-wrap chart-loading" aria-hidden="true" />,
});

export function Chart({ spec }: { spec: ChartSpec }) {
  return <ChartImpl spec={spec} />;
}
