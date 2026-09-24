import "@/styles/settings-hub.css";

import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

/** One group: its title, then a card of rows shaped like the real ones (icon tile + two lines). */
function SkeletonGroup({ rows }: { rows: number }) {
  return (
    <div className="st-group">
      <Skeleton width={96} height={13} className="st-skel-title" />
      <div className="st-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="st-row">
            <Skeleton width={36} height={36} radius={10} className="st-skel-icon" />
            <span className="st-row-body">
              <span className="st-row-text">
                <Skeleton width="45%" height={14} />
                <Skeleton width="70%" height={11} />
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Sketches the real screen (SettingsScreen): the store mark and title, then the groups in the
 * same columns — Business, Team, Bookings & queue, Account, Support, Sign out — so nothing jumps
 * when the page swaps in.
 */
export default function SettingsLoading() {
  return (
    <SkeletonScreen label={t.loading.settings}>
      <div className="page-app">
        <div className="st-head">
          <Skeleton width={44} height={44} radius={10} />
          <div className="st-head-text">
            <Skeleton width={120} height={22} />
            <Skeleton width={150} height={13} />
          </div>
        </div>
        <div className="st-columns">
          <SkeletonGroup rows={5} />
          <SkeletonGroup rows={1} />
          <SkeletonGroup rows={2} />
          <SkeletonGroup rows={3} />
          <SkeletonGroup rows={2} />
          <div className="st-signout-wrap">
            <Skeleton height={68} radius={14} />
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
