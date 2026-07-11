import { StoreHubSkeleton } from "@/components/ui/skeletons/StoreSkeletons";

/** Covers the store-open wait: stores/[id]/layout.tsx awaits getBusinessDetail, and
 *  this is the nearest boundary above that layout — so the full hub (header + tabs +
 *  overview) is skeletoned since the real chrome doesn't exist yet. The /stores list
 *  has its own (index)/loading.tsx, so it never sees this. */
export default function StoreOpenLoading() {
  return <StoreHubSkeleton />;
}
