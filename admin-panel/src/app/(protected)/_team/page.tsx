import { STATIC_AUDIT_LOG, STATIC_TEAM } from "@/lib/static-data";
import { t } from "@/i18n";

/**
 * Team, roles & audit log (wireframe 1e) — fully sample content; the admin panel
 * has a single shared login today, so multi-admin roles are placeholders.
 */
export default function TeamPage() {
  return (
    <div className="wrap">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>{t.team.title}</h1>
          <p>{t.team.subtitle}</p>
        </div>
        <button type="button" className="btn-add" disabled title={t.common.comingSoon}>
          {t.team.inviteAdmin}
        </button>
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.team.colName}</th>
                <th>{t.team.colRole}</th>
                <th>{t.team.colLastActive}</th>
              </tr>
            </thead>
            <tbody>
              {STATIC_TEAM.map((m) => (
                <tr key={m.name}>
                  <td className="nm">{m.name}</td>
                  <td>
                    <span className={`badge ${m.role === "Owner" ? "badge-vip" : "badge-inactive"}`}>{m.role}</span>
                  </td>
                  <td>{m.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h2>{t.team.auditLog}</h2>
        <div className="feed-list">
          {STATIC_AUDIT_LOG.map((entry) => (
            <div key={`${entry.time}-${entry.text}`} className="feed-item">
              <span className="feed-dot" />
              <span>{entry.text}</span>
              <span className="feed-time">{entry.time}</span>
            </div>
          ))}
        </div>
        <div className="dashed-note">{t.team.rolesNote}</div>
      </div>
    </div>
  );
}
