"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDayShort } from "@/lib/format";
import { AXIS_INK, CHART_HEIGHT, GRID_INK, SERIES_1, TOOLTIP_STYLE } from "./chart-theme";
import type { DailyValuePoint } from "./RevenueTrendChart";
import { t } from "@/i18n";

/** Single-series daily visit count bars. No legend — the card title names it. */
export default function VisitsBarChart({ data }: { data: DailyValuePoint[] }) {
  return (
    <div role="img" aria-label={t.charts.visitsBar}>
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="20%">
        <CartesianGrid stroke={GRID_INK} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayShort}
          tick={{ fontSize: 12, fill: AXIS_INK }}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: AXIS_INK }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(37, 99, 235, 0.06)" }}
          formatter={(value) => [String(value), "Visits"]}
          labelFormatter={(label) => formatDayShort(String(label))}
        />
        <Bar dataKey="value" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
