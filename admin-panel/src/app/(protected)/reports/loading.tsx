import PageHeadSkeleton from "@/components/ui/skeletons/PageHeadSkeleton";
import Skeleton from "@/components/ui/skeletons/Skeleton";
import TableSkeleton from "@/components/ui/skeletons/TableSkeleton";

/** /reports — report toggle + date range + the filtered report table. Heaviest page
 *  (N per-store fetches), so this fallback matters most. */
export default function ReportsLoading() {
  return (
    <div className="wrap">
      <PageHeadSkeleton />
      <div className="filter-row">
        <Skeleton width={260} height={34} radius={10} />
      </div>
      <div className="filter-row">
        <Skeleton width={150} height={34} radius={10} />
        <Skeleton width={150} height={34} radius={10} />
        <Skeleton width={80} height={34} radius={8} />
      </div>
      <TableSkeleton rows={7} cols={5} numCols={2} section filter />
    </div>
  );
}
