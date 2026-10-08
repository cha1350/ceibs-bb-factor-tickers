"use client";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
} from "recharts";
import type { ScoredStock, Portfolio } from "@/lib/types";
import { FACTORS, FACTOR_LABELS } from "@/lib/types";
const COLORS = [
  "#5eead4",
  "#60a5fa",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#38bdf8",
  "#94a3b8",
  "#f97316",
  "#c084fc",
  "#34d399",
  "#818cf8",
  "#e879f9",
];
const style = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 13,
};
export function AllocationChart({ portfolio }: { portfolio: Portfolio }) {
  const data = [
    ...portfolio.positions
      .filter((p) => p.dollars > 0)
      .map((p) => ({ name: p.symbol, value: p.weight * 100 })),
    { name: "Cash", value: portfolio.cashWeight * 100 },
  ];
  return (
    <div className="relative h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={72}
            outerRadius={102}
            stroke="var(--panel)"
            strokeWidth={3}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={d.name === "Cash" ? "#334454" : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={style}
            formatter={(v) => `${Number(v).toFixed(2)}%`}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-2xl font-semibold">
          {((1 - portfolio.cashWeight) * 100).toFixed(1)}%
        </span>
        <span className="muted text-xs mt-1">INVESTED</span>
      </div>
    </div>
  );
}
export function SectorChart({
  portfolio,
  cap,
}: {
  portfolio: Portfolio;
  cap: number;
}) {
  const data = portfolio.sectors.map((s) => ({
    name: s.name,
    Exposure: s.weight * 100,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 12, right: 25 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            type="number"
            domain={[0, Math.max(cap * 100, ...data.map((d) => d.Exposure), 1)]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={style}
            formatter={(v) => `${Number(v).toFixed(2)}%`}
          />
          <Bar
            dataKey="Exposure"
            fill="#5eead4"
            radius={[0, 4, 4, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function FactorChart({ stocks }: { stocks: ScoredStock[] }) {
  const chosen = stocks.filter((s) => s.score !== null).slice(0, 3);
  const data = FACTORS.filter(
    (f) => stocks[0]?.mode !== "price" || !["quality", "earnings"].includes(f),
  ).map((f) => ({
    name: FACTOR_LABELS[f],
    ...Object.fromEntries(chosen.map((s) => [s.security.symbol, s.factors[f]])),
  }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="65%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="name"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {chosen.map((s, i) => (
            <Radar
              key={s.security.symbol}
              name={s.security.symbol}
              dataKey={s.security.symbol}
              stroke={COLORS[i]}
              fill={COLORS[i]}
              fillOpacity={0.08}
              strokeWidth={2}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Tooltip contentStyle={style} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
