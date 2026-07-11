import PageHeadSkeleton from "@/components/ui/skeletons/PageHeadSkeleton";
import TableSkeleton from "@/components/ui/skeletons/TableSkeleton";

/** /stores list — shown while listBusinessesWithMetrics resolves. Its own boundary
 *  (inside the (index) group) keeps the store-open hub skeleton from leaking here. */
export default function StoresListLoading() {
  return (
    <div className="wrap">
      <PageHeadSkeleton />
      <TableSkeleton rows={6} cols={7} numCols={3} section filter />
    </div>
  );
}
