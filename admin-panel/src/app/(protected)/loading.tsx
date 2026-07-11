import PageHeadSkeleton from "@/components/ui/skeletons/PageHeadSkeleton";
import { CardSkeleton } from "@/components/ui/skeletons/CardSkeletons";

/** Fallback for the create-store form (`/`) and any (protected) segment without its
 *  own loading.tsx. Form-shaped: heading + a few section cards. */
export default function ProtectedLoading() {
  return (
    <div className="wrap">
      <PageHeadSkeleton />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={3} />
      <CardSkeleton lines={4} />
    </div>
  );
}
