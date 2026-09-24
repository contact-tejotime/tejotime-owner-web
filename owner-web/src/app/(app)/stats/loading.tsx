import { Skeleton, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";
import "@/styles/reports.css";

const TILES = [0, 1, 2];
const STAFF = [0, 1];

/**
 * Sketches Reports inside its real `.rp-*` layout, so the switch, the brand card, the tiles and the
 * staff cards sit where the data will land at every width — the same places the app pulses while
 * its first load is in flight. The card keeps its brand fill; only its figures are placeholders.
 *
 * The summary carries the same `kpi-card` classes as the page. Without them, on desktop the sketch
 * stayed a brand-filled banner beside tiles while the page arrived as a row of plain cards, so the
 * whole block changed colour and shape the moment the data landed. The bars only the phone card
 * has (its eyebrow and label) are `rp-skel-phone`, hidden on desktop where the card has neither.
 */
export default function StatsLoading() {
  return (
    <SkeletonScreen label={t.stats.loading}>
      <div className="page-app rp">
        <SkeletonHeader />

        <div className="rp-range" aria-hidden>
          <Skeleton height={36} radius={7} />
          <Skeleton height={36} radius={7} />
        </div>

        <div className="rp-summary">
          <p className="rp-summary-eyebrow" aria-hidden>
            <Skeleton width={170} height={12} />
          </p>
          <div className="rp-hero kpi-card">
            <span className="rp-hero-icon kpi-card-icon" aria-hidden />
            <div className="rp-hero-text kpi-card-text">
              <span className="rp-skel-ink rp-skel-phone" style={{ width: 170, height: 12 }} />
              <span className="rp-skel-gap rp-skel-phone" />
              <span className="rp-skel-ink rp-skel-phone" style={{ width: 70, height: 12 }} />
              <span className="rp-skel-ink rp-skel-figure" style={{ width: 130 }} />
              <span className="rp-skel-ink" style={{ width: 150, height: 12 }} />
            </div>
          </div>
          <div className="rp-metrics">
            {TILES.map((i) => (
              <div key={i} className="rp-metric kpi-card">
                <span className="rp-metric-icon kpi-card-icon" aria-hidden />
                <div className="rp-metric-figures kpi-card-text">
                  <Skeleton width={32} height={22} />
                  <Skeleton width={64} height={11} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rp-section">
          <div className="rp-section-head">
            <Skeleton width={140} height={18} />
          </div>
          <div className="rp-staff-grid">
            {STAFF.map((i) => (
              <Skeleton key={i} height={138} radius={12} />
            ))}
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
