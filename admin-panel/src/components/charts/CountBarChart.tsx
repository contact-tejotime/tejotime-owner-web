"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_INK, CHART_HEIGHT, GRID_INK, SERIES_1, TOOLTIP_STYLE } from "./chart-theme";

export interface LabelledCount {
  label: string;
  value: number;
}

/** Simple count-per-bucket bar chart (e.g. signups per month). Integer Y axis. */
export default function CountBarChart({ data, name }: { data: LabelledCount[]; name: string }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID_INK} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: AXIS_INK }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: AXIS_INK }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [String(value), name]} cursor={{ fill: "rgba(37, 99, 235, 0.06)" }} />
        <Bar dataKey="value" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
