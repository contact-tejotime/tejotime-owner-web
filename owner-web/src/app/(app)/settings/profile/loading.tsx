import { Skeleton, SkeletonCards, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonScreen label="Loading">
      <div className="wrap">
        <SkeletonHeader />
        <Skeleton height={120} radius={12} className="skeleton-mt-lg" />
        <SkeletonCards count={3} height={70} />
      </div>
    </SkeletonScreen>
  );
}
