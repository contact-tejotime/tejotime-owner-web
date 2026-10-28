import Link from "next/link";
import { redirect } from "next/navigation";
import { t, format } from "@/i18n";

import { AppPageHeader } from "@/components/AppPageHeader";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Icon, type IconName } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import { BookingSheetsHost } from "@/components/series/BookingSheets";
import { safeTimeZone } from "@/lib/appointments";
import { can, NO_ACCESS } from "@/lib/roles";
import { closedWeekdays, type PickerContext } from "@/lib/series";
import { getBusiness, getCustomers, getDueCustomers, getMe, getServices, getStaff } from "@/lib/server-api";
import { CustomerCard } from "./CustomerCard";
import { DueList } from "./DueList";
import "@/styles/customers.css";
import "@/styles/customers-due.css";

type View = "all" | "due";

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
 * "All" | "Due · N" — the app's segmented control, as Links: the view is a search param
 * (`?view=due`), so it is server-rendered, survives a reload and can be linked to. All stays the
 * default, so Customers opens exactly as it always has.
 */
function ViewSwitch({ view, dueCount }: { view: View; dueCount: number | null }) {
  const items: { key: View; href: string; label: string }[] = [
    { key: "all", href: "/customers", label: t.customers.viewAll },
    {
      key: "due",
      href: "/customers?view=due",
      label: dueCount ? format(t.customers.viewDueCount, { count: dueCount }) : t.customers.viewDue,
    },
  ];
  return (
    <nav className="due-seg" aria-label={t.customers.title}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          className="due-seg-btn"
          aria-current={view === item.key ? "page" : undefined}
        >
          {item.key === "due" ? <Icon name="calendarClock" size={14} /> : null}
          {item.label}
        </Link>
      ))}
    </nav>
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
 *
 * A second view, **Due** (docs/customer-due-list.md), is the call list: regulars who usually come
 * back about now, to phone and book. It is read uncached (a staff login sees only its own chair's
 * customers), and its count rides on the switch on both views.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q = "", view: viewParam } = await searchParams;
  const view: View = viewParam === "due" ? "due" : "all";

  const me = await getMe();
  if (!me) redirect("/login");
  const access = me.user.permissions ?? NO_ACCESS;
  const staffScoped = me.user.role === "staff";
  const canBook = can(access, "appointments", "manage");

  // All reads the customer list; Due reads what its booking sheet needs (stylists, services, the
  // store's zone and hours — the business read is profile-gated, as on Appointments). Both read the
  // call list for the count on the switch.
  const [res, due, staff, services, business] = await Promise.all([
    view === "all" ? getCustomers(q) : Promise.resolve(null),
    getDueCustomers(),
    view === "due" && canBook ? getStaff() : Promise.resolve(null),
    view === "due" && canBook ? getServices() : Promise.resolve(null),
    view === "due" && can(access, "profile") ? getBusiness() : Promise.resolve(null),
  ]);
  const customers = res?.data ?? [];
  const dueCount = due ? due.counts.overdue + due.counts.dueSoon + due.counts.lapsed : null;

  // The app's wording. A list cut short by the page size says so plainly ("Latest 100 of 312"), as
  // on the phone; otherwise the count is the whole book.
  const subtitle =
    view === "due"
      ? t.customers.due.title
      : !res
        ? undefined
        : res.shown < res.total
          ? format(t.customers.latestShown, { shown: res.shown, total: res.total })
          : format(t.customers.total, { total: res.total });

  const zone = safeTimeZone(business?.timezone);
  // What the booking sheet offers — Appointments' rule: a staff login books only on its own chair
  // (the API answers 403 otherwise), so it gets that chair and no "Any stylist".
  const picker: PickerContext = {
    zone,
    staff: (staff?.data ?? [])
      .filter((s) => s.isActive && (!staffScoped || s.id === me.user.staffId))
      .map((s) => ({ id: s.id, name: s.name, colorToken: s.colorToken })),
    allowAny: !staffScoped,
    closedDays: closedWeekdays(business?.hours),
    services: (services?.data ?? []).filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name })),
  };

  return (
    <div className="page-app">
      <AppPageHeader
        title={t.customers.title}
        subtitle={subtitle}
        // No gear: the app's Customers header has none, and Settings is already a tab (phone) or a
        // sidebar item (desktop) one tap away.
        showSettings={false}
      />

      <ViewSwitch view={view} dueCount={dueCount} />

      {view === "due" ? (
        <>
          {/* A booking (here or on the microsite), a checkout or a call logged on another device
              all change who is due. */}
          <LiveRefresh
            events={[
              "appointment:created",
              "appointment:updated",
              "appointment:checked_in",
              "queue:entry.completed",
              "customer:followup",
            ]}
            pollOnly={staffScoped}
          />
          <ScopeNotice me={me} context={t.customers.due.scopeContext} />
          {!due ? (
            <CustomersEmpty icon="alertTriangle" title={t.customers.due.loadError} />
          ) : (
            <BookingSheetsHost picker={picker} canManage={canBook}>
              <DueList list={due} zone={zone} canBook={canBook} canLog={can(access, "customers", "manage")} />
            </BookingSheetsHost>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
