import { PageHeader } from "@/components/PageHeader";

export default function NotificationsSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title="Notifications" subtitle="Alerts and reminders" />
      <div className="section">
        <h2>Preferences</h2>
        <div className="field">
          <label>
            <input type="checkbox" defaultChecked style={{ width: "auto", marginRight: 8 }} />
            Queue alerts when a customer is next
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" defaultChecked style={{ width: "auto", marginRight: 8 }} />
            Appointment reminders
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" style={{ width: "auto", marginRight: 8 }} />
            Daily summary email
          </label>
        </div>
        <button type="button" className="btn secondary">
          Save
        </button>
      </div>
    </div>
  );
}
