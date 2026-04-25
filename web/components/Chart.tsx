"use client";

import { useMemo } from "react";

export interface ChartSpec {
  type: "line" | "bar";
  title: string;
  x_label: string;
  y_label: string;
  series: { x: string | number; y: number }[];
}

const W = 540;
const H = 240;
const PAD = { left: 52, right: 18, top: 12, bottom: 38 };

export function Chart({ spec }: { spec: ChartSpec }) {
  const plot = useMemo(() => {
    const ys = spec.series.map((p) => p.y);
    const yMin = Math.min(0, ...ys);
    const yMax = Math.max(...ys, 0);
    const ticks = niceTicksFor(yMin, yMax, 4);
    const yLo = ticks[0];
    const yHi = ticks[ticks.length - 1];
    const span = yHi - yLo || 1;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const yToPx = (y: number) => PAD.top + innerH - ((y - yLo) / span) * innerH;

    const points = spec.series.map((p, i) => ({
      x:
        spec.series.length === 1
          ? PAD.left + innerW / 2
          : PAD.left + (i / (spec.series.length - 1)) * innerW,
      y: yToPx(p.y),
      label: String(p.x),
      value: p.y,
    }));

    return {
      points,
      innerW,
      innerH,
      yZero: yToPx(0),
      ticks: ticks.map((t) => ({ value: t, y: yToPx(t) })),
      baseline: H - PAD.bottom,
    };
  }, [spec.series]);

  if (spec.series.length === 0) return null;

  const linePath = plot.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const areaBase = Math.min(plot.yZero, plot.baseline);
  const areaPath =
    `M${plot.points[0].x.toFixed(2)},${areaBase.toFixed(2)} ` +
    plot.points.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") +
    ` L${plot.points[plot.points.length - 1].x.toFixed(2)},${areaBase.toFixed(2)} Z`;

  const barWidth =
    spec.series.length > 1
      ? Math.max(8, Math.min(40, (plot.innerW / spec.series.length) * 0.62))
      : 36;

  return (
    <div className="chart-wrap">
      <div className="chart-title">{spec.title}</div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={spec.title}
      >
        {plot.ticks.map((t, i) => (
          <g key={i}>
            <line
              className="chart-grid-line"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
            />
            <text
              className="chart-axis-label"
              x={PAD.left - 8}
              y={t.y + 3.5}
              textAnchor="end"
            >
              {fmtNumber(t.value)}
            </text>
          </g>
        ))}

        <line
          className="chart-axis-line"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={plot.baseline}
          y2={plot.baseline}
        />

        {spec.type === "bar" ? (
          plot.points.map((p, i) => {
            const top = Math.min(p.y, plot.yZero);
            const height = Math.abs(p.y - plot.yZero);
            return (
              <rect
                key={i}
                className="chart-bar"
                x={p.x - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(2, height)}
              >
                <title>
                  {p.label}: {fmtNumber(p.value)}
                </title>
              </rect>
            );
          })
        ) : (
          <>
            <path className="chart-area" d={areaPath} />
            <path className="chart-line" d={linePath} />
            {plot.points.map((p, i) => (
              <circle key={i} className="chart-point" cx={p.x} cy={p.y} r={3.5}>
                <title>
                  {p.label}: {fmtNumber(p.value)}
                </title>
              </circle>
            ))}
          </>
        )}

        {plot.points.map((p, i) => (
          <text
            key={i}
            className="chart-axis-label"
            x={p.x}
            y={plot.baseline + 16}
            textAnchor="middle"
          >
            {p.label}
          </text>
        ))}

        <text className="chart-axis-title" x={PAD.left} y={H - 4}>
          {spec.x_label}
        </text>
        <text
          className="chart-axis-title"
          transform={`translate(14, ${PAD.top + plot.innerH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {spec.y_label}
        </text>
      </svg>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------
function fmtNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

function niceTicksFor(min: number, max: number, count: number): number[] {
  if (min === max) {
    if (min === 0) return [0, 1];
    const padded = Math.abs(min) * 0.5;
    return [min - padded, min, min + padded];
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(round(v, 6));
  }
  return ticks;
}

function niceNum(range: number, roundIt: boolean): number {
  const exponent = Math.floor(Math.log10(Math.max(range, 1e-9)));
  const fraction = range / Math.pow(10, exponent);
  let nice: number;
  if (roundIt) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exponent);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
