import { Skeleton, SkeletonCards, SkeletonScreen } from "@/components/Skeleton";

export default function DashboardLoading() {
  return (
    <SkeletonScreen label="Loading your dashboard">
      <div className="page-app">
        <div className="skeleton-header-row">
          <Skeleton width={44} height={44} radius={12} />
          <div className="skeleton-row-text">
            <Skeleton width={160} height={17} />
            <Skeleton width={110} height={12} />
          </div>
        </div>
        <Skeleton height={44} radius={10} className="skeleton-mt-lg" />
        <Skeleton width={130} height={15} className="skeleton-mt-lg" />
        <SkeletonCards count={3} height={62} />
        <Skeleton width={130} height={15} className="skeleton-mt-lg" />
        <div className="skeleton-kpis">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={78} radius={12} />
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
