import { PageHeader } from "@/components/PageHeader";
import { t } from "@/i18n";

export default function SubscriptionSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title={t.subscription.title} subtitle={t.subscription.subtitle} />
      <div className="section">
        <h2>{t.subscription.currentPlan}</h2>
        <p>
          <strong>{t.subscription.premium}</strong> — {t.subscription.planLine}
        </p>
        <p className="hint">{t.subscription.note}</p>
        <button type="button" className="btn secondary">
          {t.subscription.manage}
        </button>
      </div>
    </div>
  );
}
