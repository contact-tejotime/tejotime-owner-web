import "@/styles/settings-hub.css";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

/** A card of `rows` settings rows, shaped like the real ones (icon tile + two lines). */
function SkeletonCard({ rows }: { rows: number }) {
  return (
    <div className="st-card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="st-row">
          <Skeleton width={36} height={36} radius={10} className="st-skel-icon" />
          <span className="st-row-body">
            <span className="st-row-text">
              <Skeleton width="35%" height={14} />
              <Skeleton width="65%" height={11} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The real shell (its title is static copy) with the page's two groups sketched below it — the
 * plan row, then the lead line and the two support rows — so nothing jumps when the page lands.
 * It used to be a generic header + banner + three cards, a different page's shape.
 */
export default function SubscriptionLoading() {
  return (
    <SettingsSubpageShell title={t.subscription.title} width="narrow">
      <SkeletonScreen label={t.loading.settings}>
        <div className="st-group">
          <Skeleton width={96} height={13} className="st-skel-title" />
          <SkeletonCard rows={1} />
        </div>
        <div className="st-group">
          <Skeleton width={96} height={13} className="st-skel-title" />
          <div className="st-skel-lead">
            <Skeleton width="92%" height={12} />
            <Skeleton width="55%" height={12} />
          </div>
          <SkeletonCard rows={2} />
        </div>
      </SkeletonScreen>
    </SettingsSubpageShell>
  );
}
