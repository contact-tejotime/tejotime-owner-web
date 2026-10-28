import { t, format } from "@/i18n";

import { AppPageHeader } from "@/components/AppPageHeader";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Icon, type IconName } from "@/components/Icon";
import { getCustomers } from "@/lib/server-api";
import { CustomerCard } from "./CustomerCard";
import "@/styles/customers.css";

/** The app's `TEmptyState`: an icon in a soft brand disc, the message, an optional hint, centred. */
function CustomersEmpty({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="cu-empty">
      <div className="cu-empty-disc" aria-hidden>
        <Icon name={icon} size={24} />
      </div>
      <p className="cu-empty-title">{title}</p>
      {hint ? <p className="cu-empty-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * Customer directory — the web twin of the app's Customers tab (`app/src/app/(app)/(tabs)/customers.tsx`):
 * header with a count, a search field, then customer cards; one column on a phone, and 300px+
 * columns wherever they fit on a tablet or desktop (see the tablet block in styles/customers.css
 * for why that is 300 and not the app's `CUSTOMER_CARD_MIN_WIDTH` of 320).
 *
 * Search runs on the SERVER (`GET /customers?search=`), not by filtering a page of results —
 * the API returns at most a page (100) of the newest customers, so client-side filtering would
 * only ever search the visible slice.
 *
 * Every plan sees the whole list (2026-10-28, docs/customer-list-no-limit.md). This page used to
 * cut a free store to its latest 2 and end the grid with an "Upgrade to Premium" prompt.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const res = await getCustomers(q);
  const customers = res?.data ?? [];

  // The app's wording. A list cut short by the page size says so plainly ("Latest 100 of 312"), as
  // on the phone; otherwise the count is the whole book.
  const subtitle = !res
    ? undefined
    : res.shown < res.total
      ? format(t.customers.latestShown, { shown: res.shown, total: res.total })
      : format(t.customers.total, { total: res.total });

  return (
    <div className="page-app">
      <AppPageHeader
        title={t.customers.title}
        subtitle={subtitle}
        // No gear: the app's Customers header has none, and Settings is already a tab (phone) or a
        // sidebar item (desktop) one tap away.
        showSettings={false}
      />

      <CustomerSearch initialQuery={q} />

      {!res ? (
        // A failed read is not an empty book: "No customers" here would tell the owner their
        // customers are gone.
        <CustomersEmpty icon="alertTriangle" title={t.customers.loadError} />
      ) : customers.length === 0 ? (
        q ? (
          <CustomersEmpty icon="search" title={t.customers.noMatch} />
        ) : (
          <CustomersEmpty icon="users" title={t.customers.empty} hint={t.customers.emptyHint} />
        )
      ) : (
        <div className="cu-list">
          {customers.map((c) => (
            <CustomerCard key={c.id} customer={c} />
          ))}
        </div>
      )}
    </div>
  );
}
