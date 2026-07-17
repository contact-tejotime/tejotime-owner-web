import BroadcastComposer from "@/components/BroadcastComposer";
import { listBusinesses } from "@/lib/server-api";
import { STATIC_BROADCAST_HISTORY, STATIC_SMS_CREDITS } from "@/lib/static-data";
import { t } from "@/i18n";

export const dynamic = "force-dynamic";

/**
 * Broadcasts (wireframe 1c) — message store owners over SMS/WhatsApp. The owner
 * count is real; composing is disabled and history/credits are sample content
 * until a messaging backend exists.
 */
export default async function BroadcastsPage() {
  const stores = await listBusinesses();
  const pct = Math.round((STATIC_SMS_CREDITS.used / STATIC_SMS_CREDITS.total) * 100);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.broadcasts.title}</h1>
        <p>{t.broadcasts.subtitle}</p>
      </div>

      <BroadcastComposer ownerCount={stores.length} />

      <div className="section">
        <h2>{t.broadcasts.history}</h2>
        <div className="table-wrap">
          <table className="store-table">
            <tbody>
              {STATIC_BROADCAST_HISTORY.map((h) => (
                <tr key={h.title}>
                  <td className="nm">{h.title}</td>
                  <td className="num" style={{ color: "var(--text-muted)" }}>
                    {h.meta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h2>{t.broadcasts.smsCredits}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ whiteSpace: "nowrap", fontSize: 13, color: "var(--text-muted)" }}>
            {STATIC_SMS_CREDITS.used.toLocaleString("en-IN")} / {STATIC_SMS_CREDITS.total.toLocaleString("en-IN")}
          </span>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
