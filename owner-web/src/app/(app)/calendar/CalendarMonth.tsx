"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type MouseEvent,
} from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { showToast } from "@/lib/toast";

/** One day on the 6×7 grid. Every string is formatted on the server, in the store's zone. */
export interface CalendarCell {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  count: number;
  /** "Thursday, 24 September" — the day sheet's title. */
  title: string;
  /** The title plus the booking count, for the day button's accessible name. */
  label: string;
}

/** One booking, shaped like the app's AppointmentListItem. */
export interface CalendarItem {
  id: string;
  time: string;
  name: string;
  /** "Haircut · John" — the service, then the chair when there is one. */
  serviceLine: string;
  status: string;
  visitorType: "mr" | "patient" | null;
  /** Still waiting to arrive AND this login may manage appointments. */
  canCheckIn: boolean;
}

/**
 * The phone layout is the app's: the grid alone, and a tap opens the day as a bottom sheet. Wider
 * screens dock the same panel beside the grid instead (calendar.css). This only decides what the
 * panel IS for assistive tech and whether it owns the page (scroll lock, Escape, focus); CSS
 * decides what shows, so the server render is already right before this hook has an answer.
 */
const PHONE_QUERY = "(max-width: 640px)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isPhoneNow = () => window.matchMedia(PHONE_QUERY).matches;
const isPhoneOnServer = () => false;

/** Status → the app's StatusBadge tone and label. */
const STATUS_TONE: Record<string, string> = {
  pending: "info",
  confirmed: "success",
  checked_in: "primary",
  completed: "success",
  cancelled: "neutral",
  no_show: "error",
};
const STATUS_LABEL: Record<string, string> = t.calendar.status;

export function CalendarMonth({
  ym,
  monthLabel,
  prevHref,
  nextHref,
  cells,
  itemsByDay,
  initialSelectedKey,
  initialImplicit,
  initialOpen,
  afterCheckInHref,
}: {
  ym: string;
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  cells: CalendarCell[];
  itemsByDay: Record<string, CalendarItem[]>;
  initialSelectedKey: string;
  /** The selected day is the page's stand-in (the 1st of a month without today), not a pick. */
  initialImplicit: boolean;
  initialOpen: boolean;
  afterCheckInHref: string | null;
}) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const [implicit, setImplicit] = useState(initialImplicit);
  const [open, setOpen] = useState(initialOpen);
  const isPhone = useSyncExternalStore(subscribePhone, isPhoneNow, isPhoneOnServer);
  const sheetOpen = isPhone && open;
  const panelRef = useRef<HTMLElement>(null);

  // Month changes go through a transition so the grid can dim while the next month loads — the
  // app's `calendarLoading` state — instead of sitting unchanged until it swaps.
  const [monthPending, startMonth] = useTransition();
  const goMonth = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    // Let the browser handle a new-tab / new-window click.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    startMonth(() => router.push(href, { scroll: false }));
  };

  // The URL carries the open day so a reload, or a link from elsewhere, lands on it. Replaced
  // rather than pushed: stepping through days should not fill Back with them.
  const writeDay = (key: string | null) => {
    window.history.replaceState(null, "", key ? `?ym=${ym}&d=${key}` : `?ym=${ym}`);
  };

  const selectDay = (key: string) => {
    setSelectedKey(key);
    setImplicit(false);
    setOpen(true);
    writeDay(key);
  };

  const close = useCallback(() => {
    setOpen(false);
    window.history.replaceState(null, "", `?ym=${ym}`);
  }, [ym]);

  // Only as a sheet does the panel own the page, like WalkInSheet: the page behind stops
  // scrolling, Escape closes, and focus moves in and comes back to the day that opened it.
  useEffect(() => {
    if (!sheetOpen) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // preventScroll, as BottomSheet does: iOS Safari scrolls the page to a focused fixed panel.
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      returnTo?.focus({ preventScroll: true });
    };
  }, [sheetOpen, close]);

  // Check-in — the app's "Add to queue". `pendingId` is cleared inside the navigation's own
  // transition, so the button keeps spinning until Home (or the refreshed day) has landed rather
  // than going idle while the server is still rendering.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startNav] = useTransition();
  const checkIn = async (item: CalendarItem) => {
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(item.id)}/check-in`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json?.error?.message ?? t.calendar.couldNotCheckIn, "error");
        setPendingId(null);
        return;
      }
      showToast(format(t.calendar.addedToQueue, { name: item.name }), "success");
      startNav(() => {
        if (afterCheckInHref) router.push(afterCheckInHref);
        else router.refresh();
        setPendingId(null);
      });
    } catch {
      showToast(t.appointments.networkError, "error");
      setPendingId(null);
    }
  };

  const selected = cells.find((c) => c.key === selectedKey);
  const items = itemsByDay[selectedKey] ?? [];

  return (
    <div className="calx">
      <section className="calx-month" aria-label={monthLabel}>
        <div className="calx-nav">
          <Link
            href={prevHref}
            scroll={false}
            className="calx-nav-btn"
            aria-label={t.calendar.prevMonth}
            onClick={(e) => goMonth(e, prevHref)}
          >
            <Icon name="chevronLeft" size={20} />
          </Link>
          <h2 className="calx-month-label">{monthLabel}</h2>
          <Link
            href={nextHref}
            scroll={false}
            className="calx-nav-btn"
            aria-label={t.calendar.nextMonth}
            onClick={(e) => goMonth(e, nextHref)}
          >
            <Icon name="chevronRight" size={20} />
          </Link>
        </div>

        {/* Hidden from assistive tech: every day button already says its weekday in full. */}
        <div className="calx-week" aria-hidden>
          {t.calendar.days.map((d, i) => (
            <span key={i} className="calx-week-day">
              {d}
            </span>
          ))}
        </div>

        <div className={`calx-grid${monthPending ? " is-loading" : ""}`} aria-busy={monthPending || undefined}>
          {cells.map((cell) => {
            const isSelected = cell.key === selectedKey;
            // On a phone the stand-in day is drawn unselected (calendar.css), so it isn't announced
            // as pressed there either.
            const isImplicit = isSelected && implicit;
            return (
              <button
                key={cell.key}
                type="button"
                className={`calx-cell${cell.inMonth ? "" : " is-muted"}${isSelected ? " is-selected" : ""}${
                  isImplicit ? " is-implicit" : ""
                }${cell.isToday ? " is-today" : ""}`}
                aria-label={cell.label}
                aria-pressed={isSelected && !(isImplicit && isPhone)}
                aria-current={cell.isToday ? "date" : undefined}
                onClick={() => selectDay(cell.key)}
              >
                <span className="calx-num">{cell.day}</span>
                <span className="calx-dot-slot" aria-hidden>
                  {cell.count > 0 ? <span className="calx-dot" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div
        className={`calx-day-layer${open ? " is-open" : ""}`}
        role={sheetOpen ? "dialog" : undefined}
        aria-modal={sheetOpen || undefined}
        aria-labelledby={sheetOpen ? "calx-day-title" : undefined}
      >
        <button type="button" className="calx-day-backdrop" aria-label={t.calendar.close} onClick={close} />
        <section className="calx-day" ref={panelRef} tabIndex={-1} aria-labelledby="calx-day-title">
          <div className="calx-day-handle" aria-hidden />
          <h2 id="calx-day-title" className="calx-day-title">
            {selected?.title ?? ""}
          </h2>
          <div className="calx-day-scroll">
            {items.length === 0 ? (
              <div className="calx-empty">
                <span className="calx-empty-disc" aria-hidden>
                  <Icon name="calendar" size={20} />
                </span>
                <p className="calx-empty-title">{t.calendar.empty}</p>
              </div>
            ) : (
              <ul className="calx-day-list">
                {items.map((item) => (
                  <li key={item.id} className="calx-appt">
                    <span className="calx-appt-time">{item.time}</span>
                    <div className="calx-appt-card">
                      <div className="calx-appt-body">
                        <div className="calx-appt-name-row">
                          <span className="calx-appt-name">{item.name}</span>
                          {item.visitorType ? (
                            <span className={`calx-badge tone-${item.visitorType === "mr" ? "info" : "secondary"}`}>
                              {item.visitorType === "mr" ? t.calendar.visitorMr : t.calendar.visitorPatient}
                            </span>
                          ) : null}
                        </div>
                        <div className="calx-appt-service">{item.serviceLine}</div>
                      </div>
                      {item.canCheckIn ? (
                        <button
                          type="button"
                          className="calx-add"
                          disabled={pendingId === item.id}
                          aria-busy={pendingId === item.id || undefined}
                          onClick={() => checkIn(item)}
                        >
                          {pendingId === item.id ? <span className="spinner calx-spinner" aria-hidden /> : null}
                          {t.calendar.addToQueue}
                        </button>
                      ) : (
                        <span className={`calx-status tone-${STATUS_TONE[item.status] ?? "neutral"}`}>
                          {STATUS_LABEL[item.status] ?? item.status.replace("_", " ")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
