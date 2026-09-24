import { Fragment } from "react";

import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

const STATS = [t.dashboard.statWaiting, t.dashboard.statInService, t.dashboard.statWalkInWait];
const CHIPS = [0, 1, 2];
const SEATS = [0, 1];

/**
 * Sketches Home's real layout: header, the live-queue card, the seats heading, chips and boards.
 *
 * Built from the page's own classes (`home-header`, `live-card` + `kpi-card`, `chip-row`,
 * `seat-list`) so the sketch takes the page's shape at every width. It used to be one 112px banner
 * over full-width blocks, which on desktop — where the card is a header row plus three cards and
 * the seats a two-column grid — changed shape the moment the data landed.
 *
 * As on the app's card, only the figures pulse: the labels are fixed words, so they are drawn as
 * they will read. The placeholders are in the card's ink (`.live-card-skel`); a grey shimmer bar
 * vanished on the brand fill.
 */
export default function DashboardLoading() {
  return (
    <SkeletonScreen label={t.loading.dashboard}>
      <div className="page-app" aria-hidden>
        <div className="home-header">
          <div className="home-header-left">
            <Skeleton width={46} height={46} radius={14} />
            <div className="skeleton-row-text">
              <Skeleton width={150} height={12} />
              <Skeleton width={170} height={20} />
            </div>
          </div>
          <Skeleton width={44} height={44} radius={10} />
        </div>

        <div className="live-card">
          <div className="live-card-top">
            <span className="live-card-eyebrow">
              <span className="live-card-dot" />
              {t.dashboard.liveQueue}
            </span>
            <span className="live-card-skel live-card-skel-cta" />
          </div>
          <div className="live-card-stats">
            {STATS.map((label, i) => (
              <Fragment key={label}>
                {i > 0 ? <span className="live-card-divider" /> : null}
                <div className="live-card-stat kpi-card">
                  <span className="live-card-icon kpi-card-icon" />
                  <span className="live-card-stat-text kpi-card-text">
                    <span className="live-card-skel live-card-skel-figure" />
                    <span className="live-card-label kpi-card-label">{label}</span>
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* A bar, not the word: a staff login's heading is "Your queue", not "Seats". */}
        <div className="home-section-row seats-head">
          <Skeleton width={90} height={18} />
        </div>
        <div className="chip-row">
          {CHIPS.map((i) => (
            <Skeleton key={i} width={72} height={34} radius={999} />
          ))}
        </div>
        <div className="seat-list">
          {SEATS.map((i) => (
            <Skeleton key={i} height={150} radius={14} />
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
