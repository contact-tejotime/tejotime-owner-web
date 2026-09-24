import "@/styles/settings-hub.css";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

/**
 * The real shell (its title is static copy), with the three fields and the button sketched
 * below it. Without this file the nearest boundary is Settings' own loading.tsx, which would
 * flash the whole hub's skeleton on the way here.
 */
export default function AccountSettingsLoading() {
  return (
    <SettingsSubpageShell title={t.password.title} width="narrow">
      <SkeletonScreen label={t.loading.settings}>
        <div className="st-account st-skel-form">
          {[0, 1, 2].map((i) => (
            <div key={i} className="st-skel-field">
              <Skeleton width={120} height={13} />
              <Skeleton height={44} radius={10} />
            </div>
          ))}
          <Skeleton height={52} radius={10} />
        </div>
      </SkeletonScreen>
    </SettingsSubpageShell>
  );
}
