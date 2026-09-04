"use client";

import { useState, type CSSProperties } from "react";
import { AppointmentCard, Avatar, Badge, WaitTimeWidget } from "@/components/landing/ds";
import { Button } from "@/components/landing/ui";
import {
  client,
  scheduleRows,
  slots,
  waitBoard,
  WAIT_MINUTES,
} from "@/components/landing/landingData";
import { t } from "@/i18n";

const eyebrowStyle: CSSProperties = {
  font: "var(--fw-bold) 11px/1 var(--font-sans)",
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const demoCardStyle: CSSProperties = {
  minWidth: 0,
  background: "var(--surface-page)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xl)",
  padding: 24,
  boxShadow: "var(--shadow-sm)",
};

type TourTab = "booking" | "walkins" | "clients";

const TABS: { id: TourTab; label: string }[] = [
  { id: "booking", label: t.landing.tour.tabs.booking },
  { id: "walkins", label: t.landing.tour.tabs.walkins },
  { id: "clients", label: t.landing.tour.tabs.clients },
];

/**
 * Homepage product tour — interactive demos behind tabs so the page can show
 * product truth without unverified shop photography.
 */
export function ProductTour({ onToast }: { onToast: (msg: string) => void }) {
  const [tab, setTab] = useState<TourTab>("booking");
  const [walkInAdded, setWalkInAdded] = useState(false);
  const waitRows = waitBoard.slice(0, walkInAdded ? 4 : 3);
  const waitMinutes = walkInAdded ? WAIT_MINUTES.afterAdd : WAIT_MINUTES.base;

  return (
    <div className="tj-tour">
      <div className="tj-tour-tabs" role="tablist" aria-label={t.landing.tour.title}>
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={"tj-tour-tab" + (active ? " is-active" : "")}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="tj-tour-panel" role="tabpanel">
        {tab === "booking" && (
          <div className="tj-demo-card tj-tour-demo" style={demoCardStyle}>
            <span style={eyebrowStyle}>{t.landing.booking.pickATime}</span>
            <div className="tj-slot-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "16px 0 20px" }}>
              {slots.map((s) => (
                <span
                  key={s.time}
                  className="tj-slot-chip"
                  style={{
                    font: "var(--fw-semibold) 14.5px/1 var(--font-sans)",
                    fontVariantNumeric: "tabular-nums",
                    padding: "13px 18px",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${s.border}`,
                    background: s.bg,
                    color: s.fg,
                  }}
                >
                  {s.time}
                </span>
              ))}
            </div>
            <Button variant="primary" fullWidth onClick={() => onToast(t.landing.toast.booking)}>
              {t.landing.booking.confirm}
            </Button>
            <div
              className="tj-demo-schedule"
              style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <span style={eyebrowStyle}>{t.landing.booking.yourSchedule}</span>
                <Badge tone="success" dot size="sm">
                  {t.landing.booking.justBooked}
                </Badge>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {scheduleRows.map((c) => (
                  <AppointmentCard
                    key={c.name}
                    name={c.name}
                    service={c.service}
                    time={c.time}
                    status={c.status}
                    style={c.style}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "walkins" && (
          <div className="tj-wait-board tj-demo-card tj-tour-demo" style={demoCardStyle}>
            <div
              className="tj-wait-head"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingBottom: 16,
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span
                className="tj-wait-title"
                style={{ font: "var(--fw-bold) 16px/1.2 var(--font-sans)", color: "var(--text-strong)" }}
              >
                {t.landing.walkins.boardTitle}
              </span>
              <span className="tj-wait-eta">
                <WaitTimeWidget
                  minutes={waitMinutes}
                  label={t.landing.walkins.estimatedWait}
                  tone="primary"
                />
              </span>
            </div>
            <div className="tj-wait-list" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
              {waitRows.map((w, idx) => (
                <div
                  key={w.name}
                  className={`tj-wait-row${walkInAdded && idx === waitRows.length - 1 ? " tj-wait-row-new" : ""}`}
                >
                  <AppointmentCard
                    name={w.name}
                    service={w.service}
                    status={w.status}
                    position={w.position}
                    waitMinutes={w.waitMinutes}
                  />
                </div>
              ))}
            </div>
            <span style={{ display: "block", marginTop: 16 }}>
              <Button
                variant="outline"
                fullWidth
                onClick={() => {
                  setWalkInAdded(true);
                  onToast(t.landing.walkins.addedToast);
                }}
                disabled={walkInAdded}
              >
                {t.landing.walkins.addWalkIn}
              </Button>
            </span>
          </div>
        )}

        {tab === "clients" && (
          <div className="tj-demo-card tj-client-card tj-tour-demo" style={demoCardStyle}>
            <div
              className="tj-client-head"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                paddingBottom: 20,
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <Avatar name={client.name} size="lg" className="tj-client-avatar" />
              <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span
                  className="tj-client-name"
                  style={{ font: "var(--fw-bold) 18px/1.2 var(--font-sans)", color: "var(--text-strong)" }}
                >
                  {client.name}
                </span>
                <span
                  className="tj-client-meta"
                  style={{ font: "var(--fw-medium) 13px/1.35 var(--font-sans)", color: "var(--text-muted)" }}
                >
                  {client.meta}
                </span>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {client.rows.map((r) => (
                <span
                  key={r.k}
                  className="tj-client-row"
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "13px 0",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <span
                    className="tj-client-k"
                    style={{ font: "var(--fw-medium) 13.5px/1 var(--font-sans)", color: "var(--text-muted)" }}
                  >
                    {r.k}
                  </span>
                  <span
                    className="tj-client-v"
                    style={{
                      font: "var(--fw-semibold) 14.5px/1.35 var(--font-sans)",
                      color: "var(--text-strong)",
                      textAlign: "right",
                    }}
                  >
                    {r.v}
                  </span>
                </span>
              ))}
            </div>
            <div className="tj-client-actions" style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <Button variant="primary" size="sm" onClick={() => onToast(t.landing.toast.booking)}>
                {t.landing.clients.rebook}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onToast(t.landing.toast.history)}>
                {t.landing.clients.viewHistory}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
