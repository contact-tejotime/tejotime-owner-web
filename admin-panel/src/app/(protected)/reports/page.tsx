import { STATIC_RECENT_EXPORTS, STATIC_REPORTS } from "@/lib/static-data";

/**
 * Reports & exports (wireframe 1d) — fully sample content; the report/export
 * backend does not exist yet, so download links render as inert "coming soon".
 */
export default function ReportsPage() {
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Reports</h1>
        <p>Scheduled digests and CSV downloads · sample content until exports go live</p>
      </div>

      <div className="report-grid">
        {STATIC_REPORTS.map((r) => (
          <div key={r.title} className="chart-card report-card" style={{ marginBottom: 0 }}>
            <h3>{r.title}</h3>
            <p>{r.description}</p>
            <div className="report-links">
              {r.formats.map((f) => (
                <span key={f} title="Coming soon">
                  {f}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Recent exports</h2>
        <div className="table-wrap">
          <table className="store-table">
            <tbody>
              {STATIC_RECENT_EXPORTS.map((e) => (
                <tr key={e.file}>
                  <td className="nm">{e.file}</td>
                  <td className="num" style={{ color: "var(--text-muted)" }}>
                    {e.date} · <span title="Coming soon">Download</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
