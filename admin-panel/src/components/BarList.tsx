import Link from "next/link";
import { t } from "@/i18n";

export interface BarListRow {
  label: string;
  value: number;
  /** Pre-formatted display value (e.g. "₹42k"); falls back to the raw number. */
  display?: string;
  sub?: string;
  href?: string;
}

/**
 * Ranked magnitude list — label, proportional bar, value. Server component;
 * used for top-5s and breakdowns where a full chart would be overkill.
 */
export default function BarList({ rows, emptyText = t.common.noData }: { rows: BarListRow[]; emptyText?: string }) {
  if (rows.length === 0) {
    return <div className="empty-note">{emptyText}</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bar-list">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="bar-list-row">
          {r.href ? (
            <Link href={r.href} className="bar-list-label">
              {r.label}
              {r.sub && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {r.sub}</span>}
            </Link>
          ) : (
            <span className="bar-list-label">
              {r.label}
              {r.sub && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {r.sub}</span>}
            </span>
          )}
          <span className="bar-list-value">{r.display ?? r.value}</span>
          <span className="bar-list-track">
            <span className="bar-list-fill" style={{ display: "block", width: `${(r.value / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
