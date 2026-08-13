import { Skeleton, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";

export default function CalendarLoading() {
  return (
    <SkeletonScreen label={t.loading.calendar}>
      <div className="page-app">
        <SkeletonHeader />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-day">
            <Skeleton width={150} height={15} />
            <Skeleton height={62} radius={12} />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
