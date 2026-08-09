import { PageHeader } from "@/components/PageHeader";

export default function SubscriptionSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title="Subscription" subtitle="Plan and billing" />
      <div className="section">
        <h2>Current plan</h2>
        <p>
          <strong>Premium</strong> — mock plan for Sharp Cut Salon
        </p>
        <p className="hint">Renews on the 1st of each month. Billing UI will connect later.</p>
        <button type="button" className="btn secondary">
          Manage plan
        </button>
      </div>
    </div>
  );
}
