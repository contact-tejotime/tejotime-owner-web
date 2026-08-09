import { Skeleton, SkeletonCards, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";

export default function CustomersLoading() {
  return (
    <SkeletonScreen label="Loading customers">
      <div className="page-app">
        <SkeletonHeader />
        <Skeleton height={42} radius={10} className="skeleton-mt-lg" />
        <SkeletonCards count={5} height={104} />
      </div>
    </SkeletonScreen>
  );
}
