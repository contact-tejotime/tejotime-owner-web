import DateRangeFilter from "@/components/DateRangeFilter";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { listInquiries } from "@/lib/server-api";
import { t } from "@/i18n";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v?: string) => (v && DATE_RE.test(v) ? v : undefined);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  let from = clean(sp.from) ?? "";
  let to = clean(sp.to) ?? "";
  if (!from && !to) {
    const now = new Date();
    to = isoDate(now);
    from = isoDate(new Date(now.getTime() - 6 * 86_400_000));
  }

  const inquiries = await listInquiries(from, to);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.inquiries.title}</h1>
        <p>{t.inquiries.subtitle}</p>
      </div>

      {!inquiries ? (
        <div className="alert err">{t.inquiries.loadError}</div>
      ) : (
        <>
          <DateRangeFilter key={`${from}|${to}`} from={from} to={to} />

          <div className="section">
            <div className="table-wrap">
              <table className="store-table">
                <thead>
                  <tr>
                    <th>{t.inquiries.colBusiness}</th>
                    <th>{t.inquiries.colAddress}</th>
                    <th>{t.inquiries.colPhone}</th>
                    <th>{t.inquiries.colSubmitted}</th>
                  </tr>
                </thead>
                <tbody>
                  {inquiries.data.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty-note">
                        {t.inquiries.emptyPeriod}
                      </td>
                    </tr>
                  )}
                  {inquiries.data.map((r) => (
                    <tr key={r.id}>
                      <td className="nm">{r.businessName}</td>
                      <td>{r.address}</td>
                      <td>{formatPhone(r.phone)}</td>
                      <td>{formatDateTime(r.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
