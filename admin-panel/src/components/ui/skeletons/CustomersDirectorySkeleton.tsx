import Skeleton from "./Skeleton";
import TableSkeleton from "./TableSkeleton";

/** Mirrors CustomersDirectory.tsx: gradient header (kept), chip/search row, then a
 *  split body — customer list table on the left, profile panel on the right. */
export default function CustomersDirectorySkeleton() {
  return (
    <div className="cust-shell">
      <div className="cust-head">
        <div className="cust-head-row">
          <div>
            <Skeleton width={140} height={20} radius={6} style={{ marginBottom: 6 }} />
            <Skeleton width={240} height={13} radius={6} />
          </div>
          <Skeleton width={110} height={36} radius={8} />
        </div>
        <div className="chip-row">
          <Skeleton width={240} height={36} radius={10} />
          <Skeleton width={130} height={36} radius={10} />
          <Skeleton width={70} height={30} radius={999} />
          <Skeleton width={90} height={30} radius={999} />
          <Skeleton width={100} height={30} radius={999} />
        </div>
      </div>

      <div className="cust-body">
        <div className="cust-list">
          <TableSkeleton rows={8} cols={3} numCols={1} />
        </div>
        <div className="cust-profile">
          <div className="profile-band" style={{ background: "var(--gray-100)" }} />
          <div className="profile-body">
            <div className="profile-avatar-row">
              <Skeleton circle width={40} height={40} />
              <span className="who" style={{ paddingTop: 24 }}>
                <Skeleton width={120} height={15} radius={6} style={{ marginBottom: 6 }} />
                <Skeleton width={160} height={12} radius={6} />
              </span>
            </div>
            <div className="tile-row">
              <Skeleton height={54} radius={10} style={{ flex: 1 }} />
              <Skeleton height={54} radius={10} style={{ flex: 1 }} />
              <Skeleton height={54} radius={10} style={{ flex: 1 }} />
            </div>
            <Skeleton width="45%" height={11} radius={5} style={{ margin: "16px 0 10px" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Skeleton height={34} radius={8} />
              <Skeleton height={34} radius={8} />
              <Skeleton height={34} radius={8} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
