import { PageHeader } from "@/components/PageHeader";
import { t } from "@/i18n";

const PREFS = [
  { id: "queue", label: t.notifications.queueAlerts, defaultChecked: true },
  { id: "reminders", label: t.notifications.apptReminders, defaultChecked: true },
  { id: "summary", label: t.notifications.dailySummary, defaultChecked: false },
] as const;

export default function NotificationsSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title={t.notifications.title} subtitle={t.notifications.subtitle} />
      <div className="section">
        <h2>{t.notifications.prefs}</h2>
        <div className="check-list">
          {PREFS.map((pref) => (
            <label key={pref.id} className="check-label">
              <input type="checkbox" defaultChecked={pref.defaultChecked} />
              <span>{pref.label}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn secondary">
          {t.notifications.save}
        </button>
      </div>
    </div>
  );
}
