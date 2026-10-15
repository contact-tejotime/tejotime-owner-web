import { redirect } from "next/navigation";
import { t, format } from "@/i18n";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { paidByAsked } from "@/lib/checkout-amount";
import { formatMoney } from "@/lib/format";
import { getCardPayments, getCardPaymentSettings, getMe, type CardPayment } from "@/lib/server-api";

/**
 * Card payments — READ-ONLY on the web (docs/card-payments-paypal.md).
 *
 * PayPal's card reader can only be driven by its native SDK, so cards are charged, refunded and
 * the reader paired in the TejoTime app, on the main owner's phone. This page shows the main
 * owner what was taken and what needs a look; it deliberately has no switch and no Refund button
 * (docs/owner-web-app-parity.md, "Deliberately different on the web").
 *
 * Gated on the main owner, as the API is: anyone else is sent back to Settings, and the API would
 * answer them 403 regardless.
 */
export default async function CardPaymentsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  // Main owner of a US store only — the same gate as the Settings row and the API.
  if (!me.user.isSuperOwner || !paidByAsked(me.business.currency)) redirect("/settings");

  const [settings, payments] = await Promise.all([getCardPaymentSettings(), getCardPayments(50)]);
  // The store's own clock: this page is rendered on the server, whose clock is not the store's.
  const timeZone = me.business.timezone || undefined;
  const when = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t.common.dash;
    return d.toLocaleString(undefined, {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <SettingsSubpageShell title={t.cardPayments.title}>
      <p className="sa-lead">{t.cardPayments.lead}</p>
      <div className="sa-card">
        <div className="sa-pref">
          <span className="sa-pref-text">
            <span className="sa-pref-label">{settings?.enabled ? t.cardPayments.on : t.cardPayments.off}</span>
          </span>
        </div>
      </div>

      <p className="sa-footnote">{t.cardPayments.recentTitle}</p>
      {!payments ? (
        <p className="sa-error">{t.cardPayments.loadError}</p>
      ) : payments.data.length === 0 ? (
        <p className="sa-error">{t.cardPayments.empty}</p>
      ) : (
        <div className="sa-card">
          {payments.data.map((p) => (
            <PaymentRow key={p.id} payment={p} when={when(p.createdAt)} />
          ))}
        </div>
      )}
    </SettingsSubpageShell>
  );
}

const STATUS: Record<CardPayment["status"], string> = {
  pending: t.cardPayments.statusPending,
  paid: t.cardPayments.statusPaid,
  failed: t.cardPayments.statusFailed,
  refunded: t.cardPayments.statusRefunded,
};

function PaymentRow({ payment: p, when }: { payment: CardPayment; when: string }) {
  const card = p.cardBrand && p.cardLast4 ? format(t.cardPayments.card, { brand: p.cardBrand, last4: p.cardLast4 }) : null;
  const sub = [when, p.serviceName, card].filter(Boolean).join(" · ");
  const hint = p.needsReview ? t.cardPayments.needsReviewHint : p.status === "pending" ? t.cardPayments.pendingHint : null;
  return (
    <div className="sa-pref">
      <span className="sa-pref-text">
        <span className="sa-pref-label">
          {p.customerName || t.cardPayments.walkIn} · {formatMoney(p.chargedAmount ?? p.amount)}
        </span>
        <span className="sa-pref-sub">{sub}</span>
        {hint ? <span className="sa-pref-sub">{hint}</span> : null}
      </span>
      <span
        className={
          p.needsReview || p.status === "pending"
            ? "sa-badge sa-badge--warn"
            : p.status === "paid"
              ? "sa-badge"
              : "sa-badge sa-badge--muted"
        }
      >
        {p.needsReview ? t.cardPayments.needsReview : STATUS[p.status]}
      </span>
    </div>
  );
}
