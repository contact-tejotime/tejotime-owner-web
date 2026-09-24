import { Fragment } from "react";

import { Skeleton, SkeletonHeader, SkeletonScreen } from "@/components/Skeleton";
import { t } from "@/i18n";
import "@/styles/customers.css";

/** Enough cards to fill a phone screen, as the app's `SKELETON_ROWS`. */
const CARDS = [0, 1, 2, 3, 4];

/**
 * Sketches the real card (`CustomerCard.tsx`) inside the real `.cu-list` grid, so the columns,
 * avatar, name/phone lines and the three-cell metrics band sit where the data will land — no jump
 * when the page swaps in, at any width.
 */
export default function CustomersLoading() {
  return (
    <SkeletonScreen label={t.loading.customers}>
      <div className="page-app">
        <SkeletonHeader />
        <div className="cu-search">
          <Skeleton height={44} radius={10} />
        </div>
        <div className="cu-list">
          {CARDS.map((k) => (
            <div key={k} className="cu-card">
              <div className="cu-card-top">
                <Skeleton width={48} height={48} radius={24} className="cu-skel-avatar" />
                <div className="cu-card-body cu-skel-lines">
                  <Skeleton width="55%" height={15} />
                  <Skeleton width="40%" height={12} />
                </div>
              </div>
              <div className="cu-meta">
                {[0, 1, 2].map((i) => (
                  <Fragment key={i}>
                    {i > 0 ? <span className="cu-meta-divider" aria-hidden /> : null}
                    <div className="cu-meta-cell cu-skel-cell">
                      <Skeleton width={34} height={15} />
                      <Skeleton width={52} height={11} />
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
