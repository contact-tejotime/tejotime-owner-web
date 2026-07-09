import DateRangeFilter from "@/components/DateRangeFilter";
import KpiCard from "@/components/KpiCard";
import { formatCount, formatDateTime, formatPercent } from "@/lib/format";
import { listStoreAppointments } from "@/lib/server-api";
import type { AppointmentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v?: string) => (v && DATE_RE.test(v) ? v : undefined);

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked in" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

const STATUS_BADGE: Record<AppointmentStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "badge-amber" },
  confirmed: { label: "Confirmed", className: "badge-vip" },
  checked_in: { label: "Checked in", className: "badge-vip" },
  completed: { label: "Completed", className: "badge-active" },
  cancelled: { label: "Cancelled", className: "badge-red" },
  no_show: { label: "No-show", className: "badge-red" },
};

export default async function StoreBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const status = STATUS_OPTIONS.some((o) => o.value === sp.status) ? sp.status : undefined;
  const bookings = await listStoreAppointments(id, { from: clean(sp.from), to: clean(sp.to), status });

  if (!bookings) {
    return <div className="alert err">Could not load bookings — is the backend running?</div>;
  }

  const { stats } = bookings;

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Bookings" value={formatCount(stats.total)} sub="in this period" />
        <KpiCard label="No-show rate" value={formatPercent(stats.noShowRate)} sub={`${stats.byStatus.noShow} no-shows`} />
        <KpiCard label="Completion rate" value={formatPercent(stats.completionRate)} sub="completed + checked in" />
        <KpiCard
          label="Online share"
          value={formatPercent(stats.onlineShare)}
          sub={`${stats.bySource.online} online · ${stats.bySource.owner} owner`}
        />
      </div>

      <DateRangeFilter from={bookings.from} to={bookings.to} status={status} statusOptions={STATUS_OPTIONS} />

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Service</th>
                <th>Staff</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {bookings.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">
                    No bookings in this period
                  </td>
                </tr>
              )}
              {bookings.data.map((a) => {
                const badge = STATUS_BADGE[a.status];
                return (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.scheduledStartAt)}</td>
                    <td className="nm">
                      {a.customerName}
                      {a.customerPhone && (
                        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {a.customerPhone}</span>
                      )}
                    </td>
                    <td>{a.serviceName || "(unknown)"}</td>
                    <td>{a.staffName || "—"}</td>
                    <td>
                      <span className={`badge ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td>{a.source === "online" ? "Online" : "Owner"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {stats.total > bookings.meta.shown && bookings.data.length === bookings.meta.shown && (
          <p className="table-note">Showing the first {bookings.meta.shown} — narrow the date range to see the rest.</p>
        )}
      </div>
    </>
  );
}
