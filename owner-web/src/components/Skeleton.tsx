/**
 * Loading placeholders.
 *
 * Every screen in this app is a Server Component that awaits the API, so navigation used to
 * show the *previous* page frozen until the new data arrived — no spinner, no dimming, nothing.
 * On a slow connection that reads as a dead click, and the usual response is to click again.
 *
 * These render from `loading.tsx` files, which Next streams immediately while the page's own
 * data is still in flight. They are laid out to match the real content they stand in for, so
 * the page does not jump when it swaps in.
 *
 * Server components on purpose — no interactivity, so no reason to ship them to the browser.
 */

export function Skeleton({
  width,
  height = 16,
  radius = 6,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width: width ?? "100%", height, borderRadius: radius }}
      aria-hidden
    />
  );
}

/** Wraps a whole loading screen so assistive tech announces it rather than reading noise. */
export function SkeletonScreen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="skeleton-screen" role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="skeleton-header">
      <Skeleton width={180} height={26} />
      <Skeleton width={120} height={14} />
    </div>
  );
}

/** A stack of card-shaped blocks — queue seats, appointments, customers, team members. */
export function SkeletonCards({ count = 3, height = 84 }: { count?: number; height?: number }) {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={12} />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width={38} height={38} radius={10} />
          <div className="skeleton-row-text">
            <Skeleton width="45%" height={13} />
            <Skeleton width="70%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small inline spinner for buttons and anywhere a block would be too heavy. */
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`spinner ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
