import { t } from "@/i18n";

import { SkeletonScreen } from "@/components/Skeleton";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { SbListSkeleton } from "@/components/store-settings/Skeletons";
import "@/styles/settings-b.css";

export default function Loading() {
  return (
    <SkeletonScreen label={t.loading.generic}>
      <SettingsSubpageShell title={t.services.title} width="wide">
        <SbListSkeleton rows={5} />
      </SettingsSubpageShell>
    </SkeletonScreen>
  );
}
