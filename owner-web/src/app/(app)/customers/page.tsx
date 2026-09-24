import Link from "next/link";
import { t, format, plural } from "@/i18n";

import { AppPageHeader } from "@/components/AppPageHeader";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Icon, type IconName } from "@/components/Icon";
import { can, NO_ACCESS } from "@/lib/roles";
import { getCustomers, getMe } from "@/lib/server-api";
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
 * the free plan truncates the list server-side and reports how many are withheld, so
 * client-side filtering would only ever search the visible slice.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const [res, me] = await Promise.all([getCustomers(q), getMe()]);
  const customers = res?.data ?? [];
  const locked = res?.lockedCount ?? 0;
  const access = me?.user.permissions ?? NO_ACCESS;

  // The app's wording. A truncated list says so plainly ("Latest 2 of 10"), as on the phone.
  const subtitle = !res
    ? undefined
    : locked > 0
      ? format(t.customers.latestShown, { shown: res.shown, total: res.total })
      : format(t.customers.total, { total: res.total });

  /*
   * Web-only, and deliberately kept: the app dropped its upgrade prompt because App Review rejects
   * an "Upgrade to Premium" with no In-App Purchase behind it. A browser has no such rule, and the
   * owner can act on it here. Shown only to a login that can open the subscription screen
   * (`billing`) — for anyone else the link lands on "no access", and the subtitle already says the
   * list is cut short.
   */
  const showUpsell = locked > 0 && can(access, "billing");

  /*
   * Rendered as the LAST ITEM of the card grid, not under it. A free store always shows exactly
   * its plan's few cards (2 by default), so beside the sidebar at 1280px the grid's three tracks
   * held two cards and a hole, with the prompt as a separate strip below at a third width. As a
   * grid item it takes that empty track (`data-after` tells styles/customers.css how many cards
   * precede it); wherever it cannot share their row it is a full-width row of its own, which is
   * how it has always looked on a phone and a tablet.
   */
  const upsell = showUpsell ? (
    <div className="cu-upsell" data-after={customers.length}>
      <div className="cu-upsell-disc" aria-hidden>
        <Icon name="star" size={20} />
      </div>
      <div className="cu-upsell-body">
        <p className="cu-upsell-title">
          {plural(locked, t.customers.lockedCountOne, t.customers.lockedCount)}
        </p>
        <p className="cu-upsell-text">{t.customers.upsell}</p>
      </div>
      <Link href="/settings/subscription" className="btn cu-upsell-cta">
        <Icon name="creditCard" size={18} />
        {t.customers.upgrade}
      </Link>
    </div>
  ) : null;

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
          {upsell}
        </div>
      )}

      {/* No grid to join only when a plan shows no cards at all (a limit of 0). */}
      {res && customers.length === 0 ? upsell : null}
    </div>
  );
}
