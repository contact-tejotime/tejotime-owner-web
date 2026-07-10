import { STATIC_AUDIT_LOG, STATIC_TEAM } from "@/lib/static-data";

/**
 * Team, roles & audit log (wireframe 1e) — fully sample content; the admin panel
 * has a single shared login today, so multi-admin roles are placeholders.
 */
export default function TeamPage() {
  return (
    <div className="wrap">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Team &amp; roles</h1>
          <p>Admins, permissions and the audit trail · sample content until multi-admin lands</p>
        </div>
        <button type="button" className="btn-add" disabled title="Coming soon">
          + Invite admin
        </button>
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Last active</th>
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
        <h2>Audit log</h2>
        <div className="feed-list">
          {STATIC_AUDIT_LOG.map((entry) => (
            <div key={`${entry.time}-${entry.text}`} className="feed-item">
              <span className="feed-dot" />
              <span>{entry.text}</span>
              <span className="feed-time">{entry.time}</span>
            </div>
          ))}
        </div>
        <div className="dashed-note">
          Roles: Owner = everything · Support = stores + customers, no billing · Analyst = read-only + reports.
        </div>
      </div>
    </div>
  );
}
