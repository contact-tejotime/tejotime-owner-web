import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { formatAmount, formatCount } from "@/lib/format";
import { listBusinessesWithMetrics } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR } from "@/lib/static-data";
import type { StoreMetrics } from "@/lib/types";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<StoreMetrics["subscriptionStatus"], { label: string; className: string }> = {
  active: { label: t.billing.statusActive, className: "badge badge-active" },
  trialing: { label: t.billing.statusTrialing, className: "badge badge-amber" },
  past_due: { label: t.billing.statusPastDue, className: "badge badge-red" },
  canceled: { label: t.billing.statusCanceled, className: "badge badge-inactive" },
};

/**
 * Subscriptions & billing (wireframe 1b). Plans and subscription statuses are
 * real (from store metrics); invoices/payments are deferred until a billing
 * backend exists.
 */
export default async function BillingPage() {
  const stores = await listBusinessesWithMetrics();
  const premium = stores.filter((s) => s.plan === "premium");
  const free = stores.filter((s) => s.plan !== "premium");
  const mrr = premium.length * PREMIUM_PLAN_PRICE_INR;

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.billing.title}</h1>
        <p>{t.billing.subtitle}</p>
      </div>

      <div className="kpi-grid">
        <KpiCard label={t.billing.freePlan} value={format(t.billing.freeStores, { count: formatCount(free.length) })} sub={formatAmount(0, "INR")} />
        <KpiCard
          label={t.billing.premium}
          value={format(t.billing.premiumStores, { count: formatCount(premium.length) })}
          sub={format(t.billing.perMonth, { price: formatAmount(PREMIUM_PLAN_PRICE_INR, "INR") })}
        />
        <KpiCard label={t.billing.mrr} value={formatAmount(mrr, "INR")} sub={t.billing.mrrSub} />
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.billing.colStore}</th>
                <th>{t.billing.colPlan}</th>
                <th>{t.billing.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {stores.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-note">
                    {t.billing.empty}
                  </td>
                </tr>
              )}
              {stores.map((s) => {
                const status = STATUS_BADGE[s.subscriptionStatus] ?? STATUS_BADGE.trialing;
                return (
                  <tr key={s.id}>
                    <td className="nm">
                      <Link href={`/stores/${s.id}`}>{s.name || t.common.unnamed}</Link>
                    </td>
                    <td>
                      <span className={`badge ${s.plan === "premium" ? "badge-plan-premium" : "badge-plan-free"}`}>
                        {s.plan === "premium" ? t.billing.planPremium : t.billing.planFree}
                      </span>
                    </td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dashed-note">{t.billing.dunningNote}</div>
      </div>
    </div>
  );
}
