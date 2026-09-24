import { Skeleton } from "@/components/Skeleton";

/*
 * Loading sketches for the settings-b pages. They reuse the real list/section classes, so the
 * placeholder has the page's own shape at every width (one card of rows on a phone, a two-up
 * grid from a tablet) and nothing jumps when the data lands.
 */

/** Services / Staff: rows with a leading mark (colour bar or avatar), two text lines, a trailer. */
export function SbListSkeleton({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <>
      <ul className="sb-list" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="sb-list-item">
            <div className="sb-item">
              {avatar ? <Skeleton width={36} height={36} radius={18} /> : <Skeleton width={4} height={38} radius={4} />}
              <span className="sb-item-body">
                <Skeleton width="55%" height={14} />
                <span style={{ display: "block", height: 6 }} />
                <Skeleton width="30%" height={11} />
              </span>
              <Skeleton width={48} height={14} />
            </div>
          </li>
        ))}
      </ul>
      <div className="sb-add">
        <Skeleton width="100%" height={44} radius={10} />
      </div>
    </>
  );
}

/** A form: section titles over cards of label + field pairs. */
export function SbFormSkeleton({ sections = 3, fields = 3 }: { sections?: number; fields?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className="sb-skel-section">
          <Skeleton width={110} height={13} />
          <div className="sb-card">
            <div className="sb-card-body">
              {Array.from({ length: fields }, (_, f) => (
                <div key={f} className="sb-field">
                  <Skeleton width={90} height={12} />
                  <Skeleton height={44} radius={10} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
