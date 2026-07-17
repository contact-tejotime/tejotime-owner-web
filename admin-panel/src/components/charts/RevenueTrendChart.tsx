"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount, formatAmountCompact, formatDayShort } from "@/lib/format";
import { AXIS_INK, CHART_HEIGHT, GRID_INK, SERIES_1, TOOLTIP_STYLE } from "./chart-theme";
import { t } from "@/i18n";

export interface DailyValuePoint {
  date: string;
  value: number;
}

/**
 * Single-series revenue area chart (values in major units of `currency`, the
 * store's ISO code). No legend — the card title names the series.
 */
export default function RevenueTrendChart({ data, currency }: { data: DailyValuePoint[]; currency: string }) {
  return (
    <div role="img" aria-label={t.charts.revenueArea}>
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_1} stopOpacity={0.18} />
            <stop offset="100%" stopColor={SERIES_1} stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          tickFormatter={(v) => formatAmountCompact(Number(v), currency)}
          tick={{ fontSize: 12, fill: AXIS_INK }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [formatAmount(Number(value), currency), "Revenue"]}
          labelFormatter={(label) => formatDayShort(String(label))}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={SERIES_1}
          strokeWidth={2}
          fill="url(#revenueFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
