import Link from "next/link";
import { t, format } from "@/i18n";

import { AppPageHeader } from "@/components/AppPageHeader";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Icon } from "@/components/Icon";
import { formatDate, formatMoney, formatPhone } from "@/lib/format";
import { getCustomers } from "@/lib/server-api";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Customer directory.
 *
 * Search runs on the SERVER (`GET /customers?search=`), not by filtering a page of results —
 * the free plan truncates the list server-side and reports how many are withheld, so
 * client-side filtering would only ever search the visible slice.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const res = await getCustomers(q);
  const customers = res?.data ?? [];
  const locked = res?.lockedCount ?? 0;

  return (
    <div className="page-app">
      <AppPageHeader
        title={t.customers.title}
        subtitle={res ? format(t.customers.shownOf, { shown: res.shown, total: res.total }) : t.common.dash}
      />

      <CustomerSearch initialQuery={q} />

      {customers.length === 0 ? (
        <p className="home-empty">
          {q ? format(t.customers.noMatch, { query: q }) : t.customers.empty}
        </p>
      ) : (
        <div className="customer-list">
          {customers.map((c) => (
            <article key={c.id} className="customer-card">
              <div className="customer-card-top">
                <div className="customer-avatar">{initials(c.name)}</div>
                <div>
                  <div className="nm">
                    {c.name}
                    {c.isVip ? " ★" : ""}
                  </div>
                  <div className="meta">{formatPhone(c.phone)}</div>
                </div>
              </div>
              <div className="customer-card-meta">
                <div>
                  <div className="label">{t.customers.visits}</div>
                  <div className="val">{c.visitsCount}</div>
                </div>
                <div>
                  <div className="label">{t.customers.lastVisit}</div>
                  <div className="val">{formatDate(c.lastVisitAt)}</div>
                </div>
                <div>
                  <div className="label">{t.customers.spend}</div>
                  <div className="val">{formatMoney(c.totalSpend)}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {locked > 0 ? (
        <div className="upsell-card">
          <div className="upsell-icon">
            <Icon name="star" size={22} color="#F59E0B" />
          </div>
          <h3>{format(t.customers.lockedCount, { count: locked })}</h3>
          <p>{t.customers.upsell}</p>
          <Link href="/settings/subscription" className="btn block">
            <Icon name="creditCard" size={18} color="#fff" />
            {t.customers.upgrade}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
