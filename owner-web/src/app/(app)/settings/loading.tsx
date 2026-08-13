import { Skeleton, SkeletonRows, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

export default function SettingsLoading() {
  return (
    <SkeletonScreen label={t.loading.settings}>
      <div className="page-app">
        <Skeleton width={140} height={26} />
        <Skeleton width={90} height={13} className="skeleton-mt-sm" />
        <Skeleton width={80} height={12} className="skeleton-mt-lg" />
        <SkeletonRows count={4} />
        <Skeleton width={80} height={12} className="skeleton-mt-lg" />
        <SkeletonRows count={2} />
      </div>
    </SkeletonScreen>
  );
}
