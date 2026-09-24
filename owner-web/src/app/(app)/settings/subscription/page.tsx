import "@/styles/settings-hub.css";

import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/Icon";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { t, plural } from "@/i18n";
import { getMe, getSubscription } from "@/lib/server-api";
import { SUPPORT } from "@/lib/support";

/**
 * One settings row, drawn with the hub's classes (settings-hub.css) so this page reads as part of
 * Settings. A server-side copy of SettingsScreen's `RowContent`, which lives in a client module;
 * keep the two in step.
 */
function Row({ icon, label, sub, chevron }: { icon: IconName; label: string; sub?: string; chevron?: boolean }) {
  return (
    <>
      <span className="st-row-icon" aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <span className="st-row-body">
        <span className="st-row-text">
          <span className="st-row-label">{label}</span>
          {sub ? <span className="st-row-sub">{sub}</span> : null}
        </span>
        {chevron ? <Icon name="chevronRight" size={18} className="st-row-chevron" /> : null}
      </span>
    </>
  );
}

/**
 * Subscription — web-only on purpose: the app must never show a plan (docs/mobile-no-in-app-purchases.md).
 *
 * It used to be a hard-coded mock: "Premium — mock plan for Sharp Cut Salon", "Renews on the 1st
 * of each month" and a "Manage plan" button with no handler. Every store is provisioned on Free,
 * so the page told a free store — one that Customers had just sent here with "Upgrade to Premium"
 * — that it was already Premium, under another shop's name. It now reads the live plan, and says
 * plainly how a plan changes today: `PAYMENTS_ENABLED` is false, so there is no checkout, and
 * wiring the button to `POST /subscription/upgrade` would hand out Premium for free (that endpoint
 * flips the plan directly while payments are off). Until billing exists, support changes it.
 *
 * The plan comes from `/subscription` (the live row, as the customer-list gate reads it); if that
 * read fails, the session's plan from `/auth/me` stands in rather than a guess.
 */
export default async function SubscriptionSettingsPage() {
  const [me, sub] = await Promise.all([getMe(), getSubscription()]);
  if (!me) redirect("/login");

  const premium = (sub?.plan ?? me.business.plan) === "premium";
  const limit = sub?.limits?.customerListLimit ?? null;
  const planSub = premium
    ? t.subscription.premiumSub
    : limit !== null
      ? plural(limit, t.subscription.freeSubOne, t.subscription.freeSub)
      : undefined;

  return (
    <SettingsSubpageShell title={t.subscription.title} width="narrow">
      <section className="st-group">
        <h2 className="st-group-title">{t.subscription.currentPlan}</h2>
        <div className="st-card">
          <div className="st-row">
            <Row
              icon="creditCard"
              label={premium ? t.subscription.premium : t.subscription.free}
              sub={planSub}
            />
          </div>
        </div>
      </section>

      <section className="st-group">
        <h2 className="st-group-title">{t.subscription.changePlan}</h2>
        <p className="st-group-lead">{t.subscription.changePlanLead}</p>
        <div className="st-card">
          <a href={`mailto:${SUPPORT.email}`} className="st-row st-row-link">
            <Row icon="mail" label={t.settings.emailSupport} sub={SUPPORT.email} chevron />
          </a>
          <a href={`tel:${SUPPORT.phoneTel}`} className="st-row st-row-link">
            <Row icon="phone" label={t.settings.callSupport} sub={SUPPORT.phoneDisplay} chevron />
          </a>
        </div>
      </section>
    </SettingsSubpageShell>
  );
}
