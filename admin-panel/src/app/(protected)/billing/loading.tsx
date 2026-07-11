import PageHeadSkeleton from "@/components/ui/skeletons/PageHeadSkeleton";
import TableSkeleton from "@/components/ui/skeletons/TableSkeleton";
import { KpiGridSkeleton } from "@/components/ui/skeletons/CardSkeletons";

/** /billing — plan KPIs + subscriptions table, mirroring BillingPage. */
export default function BillingLoading() {
  return (
    <div className="wrap">
      <PageHeadSkeleton />
      <KpiGridSkeleton count={3} />
      <TableSkeleton rows={6} cols={3} section />
    </div>
  );
}
