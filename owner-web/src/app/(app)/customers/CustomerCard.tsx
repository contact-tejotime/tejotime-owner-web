import { Fragment } from "react";
import { format, t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { formatMoney, formatPhone } from "@/lib/format";
import type { CustomerRow } from "@/lib/server-api";

/**
 * The app's initials rule (`app/src/lib/format.ts` `initials`): the first letter of the first two
 * words. The web used to take two letters of a one-word name ("RA" for Ravi where the phone showed
 * "R"), so the same customer wore a different avatar on each surface.
 */
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Digits and a leading `+` only: a formatted "+91 98765 43210" is not a dialable `tel:` target. */
function telHref(phone: string): string | null {
  const dial = phone.replace(/[^\d+]/g, "");
  return dial ? `tel:${dial}` : null;
}

/**
 * One customer — the web twin of the app's `components/cards/CustomerCard.tsx`, same blocks and
 * rules: initials avatar, name over phone, a tag, a call button, then either the three metrics in
 * a tinted band or a "No visits yet" note.
 *
 * - **Someone with no visits is a new customer, not a row of zeros.** "0 · — · ₹0" read like
 *   missing data, so the band gives way to a note and the tag reads "New". VIP still wins the tag,
 *   since VIP is something the owner set on purpose.
 * - **Last visit is the backend's `lastVisitLabel`** ("Today" / "3d" / "2w"), the string the app
 *   shows, with the app's dash when it is missing (`app/src/lib/mappers.ts` `mapCustomer`). Not a
 *   `formatDate(lastVisitAt)` fallback: this renders on the server, whose locale and UTC clock
 *   would print a different day than the store's for an evening visit.
 * - **Call is a `tel:` link**, as `Linking.openURL` is on the phone. On a laptop it hands off to
 *   whatever the OS dials with; it is omitted when there is no number.
 *
 * A Server Component on purpose: nothing on the card needs JavaScript in the browser.
 */
export function CustomerCard({ customer: c }: { customer: CustomerRow }) {
  const visits = c.visitsCount ?? 0;
  const isNew = visits === 0;
  const tel = c.phone ? telHref(c.phone) : null;
  const callLabel = format(t.customers.call, { name: c.name });
  const meta = [
    { key: "visits", label: t.customers.visits, value: String(visits) },
    { key: "last", label: t.customers.lastVisit, value: c.lastVisitLabel ?? t.common.dash },
    { key: "spend", label: t.customers.spend, value: formatMoney(c.totalSpend) },
  ];

  return (
    <article className="cu-card">
      <div className="cu-card-top">
        <div className="cu-avatar" aria-hidden>
          {initials(c.name)}
        </div>
        <div className="cu-card-body">
          <div className="cu-name">{c.name}</div>
          {c.phone ? <div className="cu-phone">{formatPhone(c.phone)}</div> : null}
        </div>
        {c.isVip ? (
          <span className="cu-badge cu-badge-vip">{t.customers.vip}</span>
        ) : isNew ? (
          <span className="cu-badge cu-badge-new">{t.customers.newCustomer}</span>
        ) : null}
        {tel ? (
          <a href={tel} className="cu-call" aria-label={callLabel} title={callLabel}>
            <Icon name="phone" size={16} />
          </a>
        ) : null}
      </div>
      {isNew ? (
        <p className="cu-note">{t.customers.noVisitsYet}</p>
      ) : (
        // Equal columns with hairline dividers, as on the app: left-packed metrics left half of
        // every card empty, and the figures didn't line up from one card to the next.
        <div className="cu-meta">
          {meta.map((m, i) => (
            <Fragment key={m.key}>
              {i > 0 ? <span className="cu-meta-divider" aria-hidden /> : null}
              <div className="cu-meta-cell">
                <div className="cu-meta-value">{m.value}</div>
                <div className="cu-meta-label">{m.label}</div>
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </article>
  );
}
