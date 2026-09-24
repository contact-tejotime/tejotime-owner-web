import { t } from "@/i18n";

import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import "@/styles/settings-b.css";

/** Intro line, then the Brand / Button / Preset cards — the top of the real page. */
export default function Loading() {
  return (
    <SkeletonScreen label={t.loading.generic}>
      <SettingsSubpageShell title={t.appearance.title} width="wide">
        <div className="sb-ap" aria-hidden>
          <div className="sb-ap-intro">
            <Skeleton width="80%" height={13} />
          </div>
          {[132, 180, 220].map((h, i) => (
            <div key={i} className="sb-skel-section">
              <Skeleton width={110} height={13} />
              <Skeleton height={h} radius={14} />
            </div>
          ))}
        </div>
      </SettingsSubpageShell>
    </SkeletonScreen>
  );
}
