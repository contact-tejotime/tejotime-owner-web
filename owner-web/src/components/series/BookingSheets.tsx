"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { t } from "@/i18n";

import type { PickerContext } from "@/lib/series";
import type { SeriesIssue } from "@/lib/server-api";

import { RescheduleSheet, type PickTarget } from "./RescheduleSheet";
import { SeriesSheet } from "./SeriesSheet";

interface BookingSheets {
  /** Open a regular's series sheet (tapping a series visit, or a Needs attention item). */
  openSeries: (seriesId: string, name: string) => void;
  /** Open the Reschedule picker — row Reschedule, or "Book another time". */
  pick: (target: PickTarget, name: string) => void;
  canManage: boolean;
}

const Ctx = createContext<BookingSheets | null>(null);

/** The nearest host, or null on a page that has none (the buttons below then render nothing). */
export function useBookingSheets(): BookingSheets | null {
  return useContext(Ctx);
}

/**
 * Owns the booking sheets for a page whose rows are Server Components — Appointments and the
 * Calendar. A row cannot hold a sheet's open state itself, so it asks the nearest host through
 * context (`OpenSeriesArea`, `BookAnotherTimeButton`, the row's Reschedule button), the way
 * RegularsList holds its own sheet.
 *
 * After a change the page is refreshed in a transition, like every mutation here, so the list
 * behind the sheet catches up with what the sheet already shows.
 */
export function BookingSheetsHost({
  picker,
  canManage,
  children,
}: {
  picker: PickerContext;
  /** `appointments: manage` — the sheets' actions; reading a series needs only `view`. */
  canManage: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [series, setSeries] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState<{ target: PickTarget; name: string } | null>(null);
  // Bumped on every refresh this host asks for, so an open series sheet re-reads what changed.
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    startTransition(() => router.refresh());
  }, [router]);

  const value = useMemo<BookingSheets>(
    () => ({
      openSeries: (id, name) => setSeries({ id, name }),
      pick: (target, name) => setPicking({ target, name }),
      canManage,
    }),
    [canManage],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {series ? (
        <SeriesSheet
          key={series.id}
          seriesId={series.id}
          name={series.name}
          version={String(version)}
          picker={picker}
          canManage={canManage}
          onClose={() => setSeries(null)}
          onChanged={refresh}
        />
      ) : null}
      {picking ? (
        <RescheduleSheet
          key={picking.target.kind === "move" ? picking.target.appointmentId : picking.target.issueId}
          target={picking.target}
          name={picking.name}
          picker={picker}
          onClose={() => setPicking(null)}
          onDone={() => {
            setPicking(null);
            refresh();
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/**
 * Makes part of a row open its regular's series sheet (Phase 1 leftover: "tap a series visit").
 * Only the row's text — never its buttons — so "Add to queue" or Skip still do just that.
 *
 * A `div role="button"` rather than a `<button>`: it wraps the row's block-level name and service
 * lines, which a button may not contain. Enter and Space work as on a button.
 */
export function OpenSeriesArea({
  seriesId,
  name,
  className,
  children,
}: {
  seriesId: string;
  name: string;
  className: string;
  children: ReactNode;
}) {
  const host = useBookingSheets();
  if (!host) return <div className={className}>{children}</div>;
  const open = () => host.openSeries(seriesId, name);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      className={`${className} srs-open`}
      title={t.series.repeating}
      onClick={open}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {children}
    </div>
  );
}

/** "Book another time" on a Needs attention item (Phase 2). Needs `appointments: manage`. */
export function BookAnotherTimeButton({ issue }: { issue: SeriesIssue }) {
  const host = useBookingSheets();
  if (!host || !host.canManage) return null;
  return (
    <button
      type="button"
      className="srs-ghost-btn"
      onClick={() =>
        host.pick(
          {
            kind: "book",
            issueId: issue.id,
            seriesId: issue.seriesId,
            occurrenceDate: issue.occurrenceDate,
            staffId: issue.staffId,
          },
          issue.customerName,
        )
      }
    >
      {t.reschedule.bookAnother}
    </button>
  );
}
