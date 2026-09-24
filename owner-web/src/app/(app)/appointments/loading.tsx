import "@/styles/appointments.css";

import { t } from "@/i18n";
import { Skeleton, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";

/** Three placeholder rows, as the app shows while its first load is in flight. */
const ROWS = [0, 1, 2];

/**
 * The app's `TAppointmentRowSkeleton`, row for row: the time column, then a card with a greyed
 * left edge, two text lines and a button-sized block — so the page doesn't jump when it lands.
 */
export default function AppointmentsLoading() {
  return (
    <SkeletonScreen label={t.appointments.loading}>
      <div className="page-app appts-screen">
        {/* The page's "+" is permission-gated; most logins that open this page have it. */}
        <div className="appts-skel-header">
          <SkeletonHeader />
          <Skeleton width={44} height={44} radius={10} />
        </div>
        <div className="appts-section-title appts-skel-title">
          <Skeleton width={150} height={18} />
        </div>
        <ul className="appts-list">
          {ROWS.map((k) => (
            <li key={k} className="appt-item appt-item-skel">
              <div className="appt-item-time">
                <Skeleton width={44} height={13} />
              </div>
              <div className="appt-item-card">
                <div className="appt-item-skel-body">
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="40%" height={11} />
                </div>
                <Skeleton width={78} height={32} radius={10} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonScreen>
  );
}
