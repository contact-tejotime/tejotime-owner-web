import { Skeleton, SkeletonCards, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

export default function Loading() {
  return (
    <SkeletonScreen label={t.loading.generic}>
      <div className="wrap">
        <SkeletonHeader />
        <Skeleton height={120} radius={12} className="skeleton-mt-lg" />
        <SkeletonCards count={3} height={70} />
      </div>
    </SkeletonScreen>
  );
}
