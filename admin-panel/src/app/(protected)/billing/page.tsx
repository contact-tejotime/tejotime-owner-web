import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { formatAmount, formatCount } from "@/lib/format";
import { listBusinessesWithMetrics } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR } from "@/lib/static-data";
import type { StoreMetrics } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<StoreMetrics["subscriptionStatus"], { label: string; className: string }> = {
  active: { label: "Active", className: "badge badge-active" },
  trialing: { label: "Trialing", className: "badge badge-amber" },
  past_due: { label: "Past due", className: "badge badge-red" },
  canceled: { label: "Canceled", className: "badge badge-inactive" },
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
        <h1>Subscriptions &amp; billing</h1>
        <p>Plans and subscription status across all stores</p>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Free plan" value={`${formatCount(free.length)} stores`} sub={formatAmount(0, "INR")} />
        <KpiCard
          label="Premium"
          value={`${formatCount(premium.length)} stores`}
          sub={`${formatAmount(PREMIUM_PLAN_PRICE_INR, "INR")}/mo`}
        />
        <KpiCard label="MRR" value={formatAmount(mrr, "INR")} sub="premium × plan price" />
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Plan</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stores.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-note">
                    No stores yet
                  </td>
                </tr>
              )}
              {stores.map((s) => {
                const status = STATUS_BADGE[s.subscriptionStatus] ?? STATUS_BADGE.trialing;
                return (
                  <tr key={s.id}>
                    <td className="nm">
                      <Link href={`/stores/${s.id}`}>{s.name || "(unnamed)"}</Link>
                    </td>
                    <td>
                      <span className={`badge ${s.plan === "premium" ? "badge-plan-premium" : "badge-plan-free"}`}>
                        {s.plan === "premium" ? "Premium" : "Free"}
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
        <div className="dashed-note">
          Dunning (planned): remind on day 1 / 3 / 7 past due → downgrade to Free on day 14. Row actions: Retry charge ·
          Send reminder.
        </div>
      </div>
    </div>
  );
}
