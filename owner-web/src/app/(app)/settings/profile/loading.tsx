import { t } from "@/i18n";

import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { SbFormSkeleton } from "@/components/store-settings/Skeletons";
import "@/styles/settings-b.css";

/** The page's own shape: the store card (beside the form on a monitor), then the sections. */
export default function Loading() {
  return (
    <SkeletonScreen label={t.loading.generic}>
      <SettingsSubpageShell title={t.profile.title} width="wide">
        <div className="sb-profile sb-profile--aside">
          <div className="sb-profile-aside" aria-hidden>
            <Skeleton height={96} radius={14} />
          </div>
          <div className="sb-profile-main">
            <SbFormSkeleton sections={3} fields={3} />
          </div>
        </div>
      </SettingsSubpageShell>
    </SkeletonScreen>
  );
}
