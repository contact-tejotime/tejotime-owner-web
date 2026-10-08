import { t, format } from "../../i18n";

/**
 * Every "is the shop open / how long is the wait" string on the store page, worked out in one
 * place so the closed state can be checked as a whole (`npm run test:status-copy`).
 *
 * Keep this file free of React and `@/` imports: the check runs it with plain tsx from backend/.
 */
export interface StatusInput {
  /** Outside business hours — MicrositeClient's `walkInsClosed`. */
  closed: boolean;
  /** "tomorrow at 9:00 AM" from the API; null when it opens nowhere in the next week. */
  nextOpenLabel: string | null;
  /** Active tickets (waiting + in service). */
  liveCount: number;
  /** Shop-wide soonest wait in minutes; 0 means a chair is free right now. */
  waitMinutes: number;
  /** The store type's own banner heading (domains.ts `ctaHeading`). */
  ctaHeading: string;
  /** "queue" / "waitlist" / "waiting list", for the team note. */
  queueWord: string;
}

export interface StatusCopy {
  /** Compact wait value: the stat tile, the team board's summary tile, the open banner's sub-line. */
  waitHeadline: string;
  /** Hero "Right now" card. `closedHeadline` replaces the queue count when set. */
  card: { closedHeadline: string | null; detail: string };
  /** The brand banner near the bottom of the page. */
  cta: { heading: string; sub: string };
  /**
   * The phone-only bottom bar. `sub` is the second line: "live" means the live status line
   * (LiveStatusLine), null means there is no second line.
   */
  bar: { headline: string; sub: string | "live" | null };
  /** The note under the team section's heading. */
  teamNote: string;
}

export function statusCopy(input: StatusInput): StatusCopy {
  const { closed, nextOpenLabel, liveCount, waitMinutes, ctaHeading, queueWord } = input;
  const opens = nextOpenLabel ? format(t.microsite.wait.opensAt, { when: nextOpenLabel }) : null;
  const waitHeadline = closed
    ? t.microsite.wait.closed
    : waitMinutes > 0
      ? format(t.microsite.wait.minWait, { min: waitMinutes })
      : t.microsite.wait.walkInNow;

  if (!closed) {
    return {
      waitHeadline,
      card: { closedHeadline: null, detail: waitHeadline },
      cta: {
        heading: ctaHeading,
        sub: liveCount === 0 ? t.microsite.cta.subEmpty : format(t.microsite.cta.subWaiting, { count: liveCount, wait: waitHeadline }),
      },
      bar: { headline: waitHeadline, sub: "live" },
      teamNote: format(t.microsite.sections.liveNote, { queueWord }),
    };
  }

  /*
   * Closed. The hero "Right now" card is the ONE place that says so (client review row 27,
   * 2026-10-08): the page used to repeat it in the card, the banner and the phone bar — up to six
   * times when the next opening was unknown. Everywhere else turns to booking, which is the one
   * thing that still works. The hours table's "Closed" on closed weekdays is a different fact and
   * stays.
   */
  return {
    waitHeadline,
    card:
      liveCount === 0
        ? { closedHeadline: t.microsite.wait.closed, detail: opens ?? t.microsite.wait.bookAhead }
        : // People still queued after closing: the card keeps their count, so "Closed" moves to
          // the line under it.
          {
            closedHeadline: null,
            detail: nextOpenLabel ? format(t.microsite.wait.closedOpens, { when: nextOpenLabel }) : t.microsite.wait.closed,
          },
    cta: { heading: t.microsite.cta.headingClosed, sub: t.microsite.cta.subClosed },
    // The card has scrolled away by the time the bar matters, so it carries the opening time —
    // without saying "closed" a second time.
    bar: { headline: opens ?? t.microsite.mobileBar.bookAhead, sub: null },
    teamNote: t.microsite.sections.liveNoteClosed,
  };
}
