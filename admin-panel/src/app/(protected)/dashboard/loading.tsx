import PageHeadSkeleton from "@/components/ui/skeletons/PageHeadSkeleton";
import Skeleton from "@/components/ui/skeletons/Skeleton";
import { KpiGridSkeleton, ChartCardSkeleton, CardSkeleton } from "@/components/ui/skeletons/CardSkeletons";

/** /dashboard — KPI row + two chart rows, mirroring PlatformDashboardPage. */
export default function DashboardLoading() {
  return (
    <div className="wrap">
      <PageHeadSkeleton />
      <div className="toolbar-row">
        <Skeleton width={420} height={40} radius={10} style={{ maxWidth: "100%" }} />
        <Skeleton width={120} height={38} radius={8} />
      </div>
      <KpiGridSkeleton count={4} />
      <div className="chart-grid" style={{ marginBottom: 18 }}>
        <ChartCardSkeleton titleWidth="45%" />
        <ChartCardSkeleton titleWidth="45%" />
      </div>
      <div className="chart-grid">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    </div>
  );
}
