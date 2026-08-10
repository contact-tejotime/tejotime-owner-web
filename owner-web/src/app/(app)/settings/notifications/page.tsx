import { PageHeader } from "@/components/PageHeader";

const PREFS = [
  { id: "queue", label: "Queue alerts when a customer is next", defaultChecked: true },
  { id: "reminders", label: "Appointment reminders", defaultChecked: true },
  { id: "summary", label: "Daily summary email", defaultChecked: false },
] as const;

export default function NotificationsSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title="Notifications" subtitle="Alerts and reminders" />
      <div className="section">
        <h2>Preferences</h2>
        <div className="check-list">
          {PREFS.map((pref) => (
            <label key={pref.id} className="check-label">
              <input type="checkbox" defaultChecked={pref.defaultChecked} />
              <span>{pref.label}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn secondary">
          Save
        </button>
      </div>
    </div>
  );
}
