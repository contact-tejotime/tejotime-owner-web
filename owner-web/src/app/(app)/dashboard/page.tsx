"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { MOCK_QUEUE, MOCK_STATS } from "@/lib/mock-data";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardPage() {
  const { session } = useAuth();
  const bizName = session?.business.name ?? "Sharp Cut";
  const queuePreview = MOCK_QUEUE.slice(0, 3);

  return (
    <div className="page-app">
      <header className="home-header">
        <div className="home-header-left">
          <div className="home-avatar" aria-hidden>
            {initials(bizName)}
          </div>
          <div>
            <div className="home-title">{bizName}</div>
            <div className="home-sub">Andheri West · Open till 9 PM</div>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Notifications">
          <Icon name="bell" size={20} />
        </button>
      </header>

      <h2 className="home-section-title">Quick actions</h2>
      <div className="home-actions">
        <Link href="/queue" className="btn home-action-primary">
          <Icon name="plus" size={18} color="#fff" />
          Add walk-in
        </Link>
        <button type="button" className="btn secondary home-action-secondary">
          <Icon name="qrCode" size={18} />
          Contact QR
        </button>
      </div>

      <div className="home-section-row">
        <h2 className="home-section-title">Active queue</h2>
        <Link href="/queue" className="home-link">
          View all
        </Link>
      </div>
      {queuePreview.length === 0 ? (
        <p className="home-empty">No one in the queue right now</p>
      ) : (
        <div className="home-queue-list">
          {queuePreview.map((q) => (
            <div key={q.id} className="home-queue-card">
              <div className="title">{q.customer}</div>
              <div className="meta">
                {q.service} · {q.staff} ·{" "}
                {q.status === "in_service" ? "In service" : `~${q.waitMins} min`}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="home-section-title">Today&apos;s summary</h2>
      <div className="home-kpi-grid">
        <div className="stat-card">
          <div className="label">Today&apos;s appts</div>
          <div className="value">{MOCK_STATS.appointmentsToday}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active</div>
          <div className="value">{MOCK_STATS.inService + MOCK_STATS.waiting}</div>
        </div>
        <div className="stat-card">
          <div className="label">Check in</div>
          <div className="value">{MOCK_STATS.checkIn}</div>
        </div>
        <div className="stat-card">
          <div className="label">Today&apos;s revenue</div>
          <div className="value">{MOCK_STATS.revenue}</div>
        </div>
      </div>
    </div>
  );
}
