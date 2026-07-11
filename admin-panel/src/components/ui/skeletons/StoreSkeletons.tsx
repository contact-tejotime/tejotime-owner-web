import Skeleton from "./Skeleton";
import { KpiGridSkeleton, ChartCardSkeleton } from "./CardSkeletons";

/** Content of the store Overview tab: Today KPIs, All-time KPIs, and the chart grid.
 *  Rendered inside the resolved store-hub header+tabs (stores/[id]/loading.tsx). */
export function StoreOverviewSkeleton() {
  return (
    <>
      <Skeleton width={60} height={11} radius={5} style={{ margin: "0 0 8px" }} />
      <KpiGridSkeleton count={4} />
      <Skeleton width={70} height={11} radius={5} style={{ margin: "0 0 8px" }} />
      <KpiGridSkeleton count={6} />
      <ChartCardSkeleton titleWidth="30%" />
      <div className="chart-grid">
        <ChartCardSkeleton titleWidth="35%" />
        <ChartCardSkeleton titleWidth="45%" />
        <ChartCardSkeleton titleWidth="40%" />
        <ChartCardSkeleton titleWidth="40%" />
      </div>
    </>
  );
}

/** Full store hub — header (name + badge + toggle), meta line, tab nav, and the
 *  overview content. Shown by stores/loading.tsx while stores/[id]/layout.tsx awaits
 *  getBusinessDetail (the real header/tabs don't exist yet during that wait). */
export function StoreHubSkeleton() {
  return (
    <div className="wrap">
      <div className="store-head">
        <Skeleton width={220} height={22} radius={7} />
        <Skeleton width={64} height={22} radius={999} />
        <span className="head-actions">
          <Skeleton width={54} height={13} radius={6} />
          <Skeleton width={36} height={20} radius={999} />
        </span>
      </div>
      <Skeleton width={320} height={14} radius={6} style={{ margin: "0 0 14px" }} />
      <div className="tab-nav">
        <Skeleton width={72} height={20} radius={6} />
        <Skeleton width={80} height={20} radius={6} />
        <Skeleton width={56} height={20} radius={6} />
        <Skeleton width={68} height={20} radius={6} />
      </div>
      <StoreOverviewSkeleton />
    </div>
  );
}
