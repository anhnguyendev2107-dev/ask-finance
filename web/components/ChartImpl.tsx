"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartSpec {
  type: "line" | "bar";
  title: string;
  x_label: string;
  y_label: string;
  series: { x: string | number; y: number }[];
}

const CHART_HEIGHT = 260;

export default function ChartImpl({ spec }: { spec: ChartSpec }) {
  const theme = useThemeColors();
  if (!spec.series || spec.series.length === 0) return null;

  const data = spec.series.map((p) => ({ x: String(p.x), y: p.y }));
  const ys = spec.series.map((p) => p.y);
  const dataMin = Math.min(...ys);
  const dataMax = Math.max(...ys);

  // Y-axis range strategy:
  //  - Data crosses 0          → use [dataMin, dataMax] (e.g. variance)
  //  - All same sign, big range → include 0 baseline (e.g. ROI 0–20)
  //  - All same sign, narrow    → tight zoom with 15% padding (e.g. margin)
  const domain = computeYDomain(dataMin, dataMax);
  const showZeroLine = dataMin < 0 && dataMax > 0;

  return (
    <div className="chart-wrap">
      <div className="chart-title">{spec.title}</div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        {spec.type === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="x"
              tick={{ fill: theme.muted, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: theme.axis }}
              label={xAxisLabel(spec.x_label, theme)}
              height={42}
            />
            <YAxis
              domain={domain}
              tick={{ fill: theme.muted, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={56}
              label={yAxisLabel(spec.y_label, theme)}
              tickFormatter={fmt}
            />
            <Tooltip
              cursor={{ fill: theme.cursor }}
              contentStyle={tooltipStyle(theme)}
              labelStyle={{ color: theme.text, fontSize: 12 }}
              itemStyle={{ color: theme.accent }}
              formatter={(v) => [fmt(Number(v)), spec.y_label]}
            />
            {showZeroLine && <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1} />}
            <Bar dataKey="y" fill={theme.accent} radius={[4, 4, 0, 0]} animationDuration={420} />
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <defs>
              <linearGradient id={`gradient-${theme.scheme}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.accent} stopOpacity={0.28} />
                <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="x"
              tick={{ fill: theme.muted, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: theme.axis }}
              label={xAxisLabel(spec.x_label, theme)}
              height={42}
            />
            <YAxis
              domain={domain}
              tick={{ fill: theme.muted, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={56}
              label={yAxisLabel(spec.y_label, theme)}
              tickFormatter={fmt}
            />
            <Tooltip
              cursor={{ stroke: theme.accent, strokeWidth: 1, strokeDasharray: "3 3" }}
              contentStyle={tooltipStyle(theme)}
              labelStyle={{ color: theme.text, fontSize: 12 }}
              itemStyle={{ color: theme.accent }}
              formatter={(v) => [fmt(Number(v)), spec.y_label]}
            />
            {showZeroLine && <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1} />}
            <Area
              type="monotone"
              dataKey="y"
              stroke={theme.accent}
              strokeWidth={2}
              fill={`url(#gradient-${theme.scheme})`}
              dot={{ r: 3.5, fill: theme.accent, stroke: theme.bg, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: theme.accent2, stroke: theme.bg, strokeWidth: 2 }}
              animationDuration={520}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// --- helpers ----------------------------------------------------------------

function computeYDomain(dataMin: number, dataMax: number): [number, number] {
  if (dataMin < 0 && dataMax > 0) return [dataMin, dataMax];
  const reference = Math.max(Math.abs(dataMin), Math.abs(dataMax));
  const range = dataMax - dataMin;
  const wide = reference > 0 && range / reference > 0.5;
  if (wide) return [Math.min(0, dataMin), Math.max(0, dataMax)];
  const pad = (range || reference * 0.1) * 0.15;
  return [dataMin - pad, dataMax + pad];
}

function fmt(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

function xAxisLabel(text: string, theme: ThemeColors) {
  return {
    value: text,
    position: "insideBottom" as const,
    offset: -2,
    style: {
      fill: theme.mutedDeep,
      fontSize: 10,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
    },
  };
}

function yAxisLabel(text: string, theme: ThemeColors) {
  return {
    value: text,
    angle: -90,
    position: "insideLeft" as const,
    style: {
      fill: theme.mutedDeep,
      fontSize: 10,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
      textAnchor: "middle" as const,
    },
    offset: 14,
  };
}

function tooltipStyle(theme: ThemeColors): React.CSSProperties {
  return {
    background: theme.tooltipBg,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    boxShadow: theme.shadow,
    padding: "8px 10px",
    fontSize: 12,
  };
}

// Theme adaptation — read CSS variables and re-render on theme change.
interface ThemeColors {
  scheme: "dark" | "light";
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  mutedDeep: string;
  grid: string;
  axis: string;
  cursor: string;
  bg: string;
  border: string;
  tooltipBg: string;
  shadow: string;
}

function readTheme(): ThemeColors {
  if (typeof document === "undefined") return defaultTheme();
  const cs = getComputedStyle(document.documentElement);
  const scheme: "dark" | "light" =
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    scheme,
    accent: v("--accent", "#6c8cff"),
    accent2: v("--accent-2", "#8aa3ff"),
    text: v("--text", "#e8edff"),
    muted: v("--muted", "#8d99c3"),
    mutedDeep: v("--muted-2", "#6c779f"),
    grid: v("--border", "#232b48"),
    axis: v("--border-strong", "#2e3a60"),
    cursor: scheme === "dark" ? "rgba(108,140,255,0.06)" : "rgba(79,70,229,0.06)",
    bg: v("--bg", "#0a0e1a"),
    border: v("--border", "#232b48"),
    tooltipBg: v("--panel", "#111728"),
    shadow: scheme === "dark" ? "0 6px 18px rgba(0,0,0,0.35)" : "0 8px 24px rgba(15,23,42,0.08)",
  };
}

function defaultTheme(): ThemeColors {
  return {
    scheme: "dark",
    accent: "#6c8cff",
    accent2: "#8aa3ff",
    text: "#e8edff",
    muted: "#8d99c3",
    mutedDeep: "#6c779f",
    grid: "#232b48",
    axis: "#2e3a60",
    cursor: "rgba(108,140,255,0.06)",
    bg: "#0a0e1a",
    border: "#232b48",
    tooltipBg: "#111728",
    shadow: "0 6px 18px rgba(0,0,0,0.35)",
  };
}

function useThemeColors(): ThemeColors {
  const [theme, setTheme] = useState<ThemeColors>(defaultTheme);
  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        setTheme(readTheme());
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  return theme;
}
