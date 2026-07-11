import Skeleton from "./Skeleton";

/** Mirrors the `.page-head` block: an h1-sized bar + a muted subtitle bar. */
export default function PageHeadSkeleton() {
  return (
    <div className="page-head">
      <Skeleton width={200} height={24} radius={7} style={{ marginBottom: 8 }} />
      <Skeleton width={280} height={13} radius={6} style={{ marginBottom: 20 }} />
    </div>
  );
}
