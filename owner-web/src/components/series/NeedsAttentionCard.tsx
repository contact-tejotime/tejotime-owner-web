import "@/styles/series.css";

import { format, t } from "@/i18n";

import { Icon } from "@/components/Icon";
import type { SeriesIssue } from "@/lib/server-api";
import { issueReasonLabel, telHref, whenLabel } from "@/lib/series";

import { BookAnotherTimeButton, OpenSeriesArea } from "./BookingSheets";
import { ResolveIssueButton } from "./ResolveIssueButton";

/**
 * Needs attention — repeating visits the background job could not book (the time was taken, the
 * hours changed, the stylist left, a service was removed). Sits at the top of the Today view.
 *
 * Nothing is texted to the customer about these (decided with the client: only the three
 * registered SMS go out), so each item leads with **Call**. "Book another time" (Phase 2) books
 * that one date at a time the owner picks; "Mark handled" closes it once the owner has sorted it
 * out another way. Tapping the item's text opens the regular's series sheet (inside a
 * BookingSheetsHost; without one it is plain text).
 *
 * A Server Component: the times are formatted on the store's clock here, and only "Mark handled"
 * needs the browser.
 */
export function NeedsAttentionCard({
  issues,
  zone,
  canManage,
}: {
  issues: SeriesIssue[];
  zone: string;
  /** `appointments: manage` — what the resolve endpoint needs. Call is for everyone. */
  canManage: boolean;
}) {
  return (
    <section className="srs-attn" aria-labelledby="srs-attn-title">
      <div className="srs-attn-head">
        <span className="srs-attn-icon" aria-hidden>
          <Icon name="alertTriangle" size={18} />
        </span>
        <div className="srs-attn-head-text">
          <h2 id="srs-attn-title" className="srs-attn-title">
            {t.series.needsAttention}
          </h2>
          <p className="srs-attn-sub">{t.series.needsAttentionSub}</p>
        </div>
      </div>
      <ul className="srs-attn-list">
        {issues.map((issue) => {
          const tel = telHref(issue.customerPhone);
          return (
            <li key={issue.id} className="srs-attn-item">
              <OpenSeriesArea seriesId={issue.seriesId} name={issue.customerName} className="srs-attn-body">
                <p className="srs-attn-name">{issue.customerName}</p>
                <p className="srs-attn-when">{whenLabel(issue.scheduledStartAt, zone)}</p>
                <p className="srs-attn-reason">{issueReasonLabel(issue.reason)}</p>
              </OpenSeriesArea>
              <div className="srs-attn-actions">
                {tel ? (
                  <a
                    className="srs-call"
                    href={tel}
                    aria-label={format(t.series.callAria, { name: issue.customerName })}
                  >
                    <Icon name="phone" size={14} />
                    {t.series.call}
                  </a>
                ) : null}
                <BookAnotherTimeButton issue={issue} />
                {canManage ? <ResolveIssueButton issueId={issue.id} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
