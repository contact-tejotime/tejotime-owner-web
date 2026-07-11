import Skeleton, { SkeletonText } from "./Skeleton";

/** Mirrors KpiCard.tsx: label bar (11px), value bar (26px), sub bar (12px). */
export function KpiCardSkeleton() {
  return (
    <div className="kpi-card">
      <Skeleton width="55%" height={11} radius={5} style={{ marginBottom: 8 }} />
      <Skeleton width="70%" height={22} radius={6} />
      <Skeleton width="45%" height={11} radius={5} style={{ marginTop: 8 }} />
    </div>
  );
}

/** A `.kpi-grid` of N KpiCardSkeletons (defaults to 4, the common dashboard row). */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** The 260px chart body (matches CHART_HEIGHT) — used as the next/dynamic fallback,
 *  sitting inside an existing `.chart-card` (so no card/title of its own). */
export function ChartBodySkeleton() {
  return <Skeleton height={260} radius={10} />;
}

/** A full `.chart-card` with a title bar + chart body — for route loading.tsx where
 *  the real card shell doesn't exist yet. */
export function ChartCardSkeleton({ titleWidth = "40%" }: { titleWidth?: number | string }) {
  return (
    <div className="chart-card">
      <Skeleton width={titleWidth} height={15} radius={6} style={{ marginBottom: 14 }} />
      <ChartBodySkeleton />
    </div>
  );
}

/** Generic `.section` card with a heading bar + text lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="section">
      <Skeleton width="35%" height={16} radius={6} style={{ marginBottom: 14 }} />
      <SkeletonText lines={lines} />
    </div>
  );
}
