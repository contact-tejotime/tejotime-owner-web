import "@/styles/calendar.css";

import { Skeleton, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

/**
 * The calendar's own layout, so nothing jumps when the page swaps in: the month row, the weekday
 * letters (static, so they are real), a 6×7 grid of day discs, and — on a tablet or desktop,
 * where the day is docked — its card. On a phone that card stays hidden, as the sheet does until
 * a day is tapped.
 */
export default function CalendarLoading() {
  return (
    <SkeletonScreen label={t.loading.calendar}>
      <div className="page-app calx-page">
        <SkeletonHeader />
        <div className="calx">
          <div className="calx-month">
            <div className="calx-nav">
              <Skeleton width={44} height={44} radius={10} />
              <Skeleton width={150} height={20} />
              <Skeleton width={44} height={44} radius={10} />
            </div>
            <div className="calx-week">
              {t.calendar.days.map((d, i) => (
                <span key={i} className="calx-week-day">
                  {d}
                </span>
              ))}
            </div>
            <div className="calx-grid">
              {Array.from({ length: 42 }, (_, i) => (
                <span key={i} className="calx-cell">
                  <Skeleton width={40} height={40} radius={999} />
                  <span className="calx-dot-slot" />
                </span>
              ))}
            </div>
          </div>
          <div className="calx-day-layer">
            <div className="calx-day">
              <Skeleton width="55%" height={24} />
              <div className="calx-day-list calx-skeleton-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} height={66} radius={10} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
