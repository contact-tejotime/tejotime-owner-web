import { Skeleton, SkeletonCards, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";

export default function QueueLoading() {
  return (
    <SkeletonScreen label="Loading the queue">
      <div className="page-app">
        <SkeletonHeader />
        <Skeleton height={40} radius={10} className="skeleton-mt-lg" />
        <SkeletonCards count={3} height={150} />
      </div>
    </SkeletonScreen>
  );
}
