import { SkeletonCards, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";

export default function AppointmentsLoading() {
  return (
    <SkeletonScreen label="Loading today's appointments">
      <div className="page-app">
        <SkeletonHeader />
        <SkeletonCards count={4} height={76} />
      </div>
    </SkeletonScreen>
  );
}
