"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_HEIGHT, SERIES_1, SERIES_2, TOOLTIP_STYLE } from "./chart-theme";

/**
 * Walk-in vs online donut — exactly two slices with a white gap between them,
 * direct-labeled so identity never rests on color alone.
 */
export default function SourcePie({ walkIn, online }: { walkIn: number; online: number }) {
  const total = walkIn + online;
  if (total === 0) {
    return <div className="empty-note">No visits in this period yet</div>;
  }

  const data = [
    { name: "Walk-in", value: walkIn, color: SERIES_1 },
    { name: "Online", value: online, color: SERIES_2 },
  ].filter((d) => d.value > 0);

  const pct = (value: number) => `${Math.round((value / total) * 100)}%`;

  return (
    <div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT - 60}>
        <PieChart>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [`${value} (${pct(Number(value))})`, String(name)]}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            stroke="#ffffff"
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 10, fontSize: 13 }}>
        {data.map((d) => (
          <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: d.color }} />
            {d.name} · {d.value} ({pct(d.value)})
          </span>
        ))}
      </div>
    </div>
  );
}
