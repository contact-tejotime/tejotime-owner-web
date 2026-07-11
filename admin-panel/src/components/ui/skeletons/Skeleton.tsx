import type { CSSProperties } from "react";

/** Base shimmer block. Pure markup (no client hooks) so it renders in server
 *  components and loading.tsx. Size/shape via props; visual comes from the
 *  `.skeleton` class in globals.css. */
export default function Skeleton({
  width,
  height,
  radius,
  circle,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={circle ? "skeleton circle" : className ? `skeleton ${className}` : "skeleton"}
      aria-hidden
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** N stacked text-line bars; the last line is shortened to look like prose. */
export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: number | string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? "60%" : width} radius={6} />
      ))}
    </span>
  );
}
