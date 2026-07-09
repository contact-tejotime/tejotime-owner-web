import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { formatAmount, formatCount } from "@/lib/format";
import { listBusinessesWithMetrics } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR, STATIC_BILLING } from "@/lib/static-data";

export const dynamic = "force-dynamic";

/**
 * Subscriptions & billing (wireframe 1b). Plan assignments are real (from store
 * metrics); invoices, payment status and MRR pricing are placeholders — there is
 * no billing backend yet.
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
        <p>Plans and invoices across all stores · invoice data is sample content until billing goes live</p>
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
                <th>Next invoice</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stores.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-note">
                    No stores yet
                  </td>
                </tr>
              )}
              {stores.map((s) => (
                <tr key={s.id}>
                  <td className="nm">
                    <Link href={`/stores/${s.id}`}>{s.name || "(unnamed)"}</Link>
                  </td>
                  <td>
                    <span className={`badge ${s.plan === "premium" ? "badge-plan-premium" : "badge-plan-free"}`}>
                      {s.plan === "premium" ? "Premium" : "Free"}
                    </span>
                  </td>
                  <td>{s.plan === "premium" ? STATIC_BILLING.premiumNextInvoice : "—"}</td>
                  <td>{s.plan === "premium" ? <span className="badge badge-active">{STATIC_BILLING.premiumStatus}</span> : "—"}</td>
                </tr>
              ))}
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
