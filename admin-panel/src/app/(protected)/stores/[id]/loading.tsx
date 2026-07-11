import { StoreOverviewSkeleton } from "@/components/ui/skeletons/StoreSkeletons";

/** Tab switches within a store (overview/customers/visits/settings). Renders inside
 *  the already-resolved store-hub header + tabs, so it's just the content area
 *  (mirrors the default Overview tab). */
export default function StoreTabLoading() {
  return <StoreOverviewSkeleton />;
}
